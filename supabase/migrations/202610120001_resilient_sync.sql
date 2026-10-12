-- Per-record push results, O(1) quota accounting, bounded receipts and recent-login account deletion.
-- Safe to run while older pages are open: qiaoqiao_push keeps its all-or-nothing behaviour for them.
begin;

alter table public.qiaoqiao_sync_heads add column if not exists bytes bigint not null default 0;
update public.qiaoqiao_sync_heads h set bytes = coalesce((
  select sum(octet_length(r.key) + octet_length(r.value::text)) from public.qiaoqiao_sync_rows r where r.user_id = h.user_id
), 0);

alter table public.qiaoqiao_sync_receipts add column if not exists created_at timestamptz not null default now();
create index if not exists qiaoqiao_sync_receipt_age on public.qiaoqiao_sync_receipts(user_id, created_at);

create or replace function public.qiaoqiao_account_quota()
returns bigint language sql stable set search_path = '' as $$ select 52428800::bigint $$;

create or replace function public.qiaoqiao_setting_allowed(entry_key text)
returns boolean language sql immutable set search_path = '' as $$
  select entry_key in ('typelingo.mode', 'typelingo.daily-new', 'typelingo.selected-deck.v1', 'qiaoqiao.companion.v1')
    or entry_key like 'typelingo.deck-level.v1:%'
$$;

create or replace function public.qiaoqiao_try_timestamptz(value text)
returns timestamptz language plpgsql stable set search_path = '' as $$
begin
  return value::timestamptz;
exception when others then
  return null;
end;
$$;

-- Each change gets {mutationId, status, error}: "ok" (stored or already stored), "retry" (keep it
-- queued: device clock ahead, quota full, setting unknown to this database) or "rejected" (never storable).
create or replace function public.qiaoqiao_push_v2(changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  quota bigint := public.qiaoqiao_account_quota();
  next_version bigint;
  used bigint;
  change jsonb;
  entry_kind text;
  entry_key text;
  body jsonb;
  mutation uuid;
  previous jsonb;
  reviewed timestamptz;
  added bigint;
  outcome text;
  reason text;
  results jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'authentication_required'; end if;
  if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes) > 100
    or octet_length(changes::text) > 12582912 then raise exception 'sync_batch_too_large'; end if;
  insert into public.qiaoqiao_sync_heads(user_id) values (uid) on conflict do nothing;
  select version, bytes into next_version, used from public.qiaoqiao_sync_heads where user_id = uid for update;
  for change in select value from jsonb_array_elements(changes) loop
    outcome := 'rejected'; reason := 'invalid_sync_record';
    entry_kind := change->>'kind'; entry_key := change->>'key'; body := change->'value';
    mutation := case when change->>'mutationId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      then (change->>'mutationId')::uuid end;
    reviewed := case when entry_kind = 'review' then public.qiaoqiao_try_timestamptz(body->>'reviewedAt') end;
    if mutation is null or entry_kind is null
      or entry_kind not in ('review', 'history', 'seed', 'skip', 'setting', 'deck')
      or entry_key is null or length(entry_key) not between 1 and 2000
      or body is null or body = 'null'::jsonb then
      null;
    elsif octet_length(body::text) > (case when entry_kind = 'deck' then 10485760 else 16384 end) then
      reason := 'sync_record_too_large';
    elsif entry_kind in ('review', 'history', 'seed', 'deck')
      and (jsonb_typeof(body) <> 'object' or body->>'id' is distinct from entry_key) then
      null;
    elsif (entry_kind = 'skip' and jsonb_typeof(body) <> 'boolean')
      or (entry_kind = 'setting' and jsonb_typeof(body) <> 'string')
      or (entry_kind = 'review' and (reviewed is null or not isfinite(reviewed))) then
      null;
    elsif entry_kind = 'setting' and not public.qiaoqiao_setting_allowed(entry_key) then
      outcome := 'retry'; reason := 'unknown_setting';
    elsif entry_kind = 'review' and reviewed > now() + interval '5 minutes' then
      outcome := 'retry'; reason := 'device_clock_ahead';
    elsif exists (select 1 from public.qiaoqiao_sync_receipts where user_id = uid and mutation_id = mutation) then
      outcome := 'ok'; reason := null;
    else
      outcome := 'ok'; reason := null;
      previous := null;
      select value into previous from public.qiaoqiao_sync_rows
        where user_id = uid and kind = entry_kind and key = entry_key;
      -- Review IDs are immutable. Receipts also stop a retry of an older setting
      -- from overwriting a newer change accepted from another device.
      if previous is not null and (entry_kind = 'review' or previous = body
        or (entry_kind = 'history' and (previous->>'completedAt') > (body->>'completedAt'))
        or (entry_kind = 'seed' and (previous->>'updatedAt') >= (body->>'updatedAt'))) then
        insert into public.qiaoqiao_sync_receipts(user_id, mutation_id) values (uid, mutation);
      else
        added := octet_length(entry_key) + octet_length(body::text)
          - coalesce(octet_length(entry_key) + octet_length(previous::text), 0);
        if added > 0 and used + added > quota then
          outcome := 'retry'; reason := 'account_sync_quota_exceeded';
        else
          next_version := next_version + 1; used := used + added;
          insert into public.qiaoqiao_sync_rows values (uid, entry_kind, entry_key, body, next_version)
            on conflict (user_id, kind, key) do update set value = excluded.value, version = excluded.version;
          insert into public.qiaoqiao_sync_receipts(user_id, mutation_id) values (uid, mutation);
        end if;
      end if;
    end if;
    results := results || jsonb_build_array(jsonb_build_object(
      'mutationId', change->'mutationId', 'status', outcome, 'error', reason));
  end loop;
  update public.qiaoqiao_sync_heads set version = next_version, bytes = used where user_id = uid;
  -- A receipt only guards against late retries of the same mutation; keep a month of them.
  delete from public.qiaoqiao_sync_receipts where user_id = uid and created_at < now() - interval '30 days';
  return results;
end;
$$;

-- Pages loaded before this migration expect all-or-nothing batches.
create or replace function public.qiaoqiao_push(changes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  failure text;
begin
  select result->>'error' into failure from jsonb_array_elements(public.qiaoqiao_push_v2(changes)) as result
    where result->>'status' <> 'ok' limit 1;
  if failure is not null then raise exception '%', failure; end if;
end;
$$;

-- The page asks for the password again right before deleting. Require that sign-in here too,
-- so an access token copied from a shared computer cannot delete the account on its own.
create or replace function public.qiaoqiao_delete_account()
returns void language plpgsql security definer set search_path = '' as $$
declare
  claims jsonb := auth.jwt();
  signed_in_at numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select max((method->>'timestamp')::numeric) into signed_in_at
    from jsonb_array_elements(case when jsonb_typeof(claims->'amr') = 'array' then claims->'amr' else '[]'::jsonb end) as method
    where method->>'method' = 'password';
  if signed_in_at is null or signed_in_at < extract(epoch from now()) - 600 then
    raise exception 'reauthentication_required';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.qiaoqiao_push_v2(jsonb) from public, anon;
grant execute on function public.qiaoqiao_push_v2(jsonb) to authenticated;
revoke all on function public.qiaoqiao_account_quota(), public.qiaoqiao_setting_allowed(text),
  public.qiaoqiao_try_timestamptz(text) from public, anon, authenticated;
commit;
