-- Only learning records are synced: sentence reviews, round history, schedule checkpoints and
-- permanent skips. Decks and settings stay on each device, so their cloud copies are removed.
-- Pages loaded earlier may still upload them; they get "ok" without anything being stored,
-- which lets their upload queues drain instead of retrying forever.
begin;

delete from public.qiaoqiao_sync_rows where kind in ('deck', 'setting');
update public.qiaoqiao_sync_heads h set bytes = coalesce((
  select sum(octet_length(r.key) + octet_length(r.value::text)) from public.qiaoqiao_sync_rows r where r.user_id = h.user_id
), 0);

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
      or entry_key is null or length(entry_key) not between 1 and 2000 then
      null;
    elsif entry_kind in ('setting', 'deck') then
      outcome := 'ok'; reason := null;
    elsif body is null or body = 'null'::jsonb then
      null;
    elsif octet_length(body::text) > 16384 then
      reason := 'sync_record_too_large';
    elsif entry_kind in ('review', 'history', 'seed')
      and (jsonb_typeof(body) <> 'object' or body->>'id' is distinct from entry_key) then
      null;
    elsif (entry_kind = 'skip' and jsonb_typeof(body) <> 'boolean')
      or (entry_kind = 'review' and (reviewed is null or not isfinite(reviewed))) then
      null;
    elsif entry_kind = 'review' and reviewed > now() + interval '5 minutes' then
      outcome := 'retry'; reason := 'device_clock_ahead';
    elsif exists (select 1 from public.qiaoqiao_sync_receipts where user_id = uid and mutation_id = mutation) then
      outcome := 'ok'; reason := null;
    else
      outcome := 'ok'; reason := null;
      previous := null;
      select value into previous from public.qiaoqiao_sync_rows
        where user_id = uid and kind = entry_kind and key = entry_key;
      -- Review IDs are immutable. Receipts also stop a retry of an older skip change
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

drop function if exists public.qiaoqiao_setting_allowed(text);
commit;
