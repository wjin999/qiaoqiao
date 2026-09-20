-- Allow the companion selection/display preferences to sync. No data is deleted.
create or replace function public.qiaoqiao_push(changes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  current_version bigint;
  change jsonb;
  previous jsonb;
  entry_kind text;
  entry_key text;
  body jsonb;
  inserted integer;
begin
  if uid is null then raise exception 'authentication_required'; end if;
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) > 100
    or octet_length(changes::text) > 12582912 then raise exception 'sync_batch_too_large'; end if;
  insert into public.qiaoqiao_sync_heads(user_id) values(uid) on conflict do nothing;
  select version into current_version from public.qiaoqiao_sync_heads where user_id = uid for update;
  for change in select * from jsonb_array_elements(changes) loop
    entry_kind := change->>'kind'; entry_key := change->>'key'; body := change->'value';
    if entry_kind is null or entry_kind not in ('review','history','seed','skip','setting','deck')
      or entry_key is null or length(entry_key) not between 1 and 2000 or body is null
      or body = 'null'::jsonb then raise exception 'invalid_sync_record'; end if;
    if octet_length(body::text) > (case when entry_kind = 'deck' then 10485760 else 16384 end)
      then raise exception 'sync_record_too_large'; end if;
    if entry_kind in ('review','history','seed','deck') and
      (jsonb_typeof(body) <> 'object' or body->>'id' is distinct from entry_key)
      then raise exception 'invalid_sync_record'; end if;
    if entry_kind = 'skip' and jsonb_typeof(body) <> 'boolean' then raise exception 'invalid_sync_record'; end if;
    if entry_kind = 'setting' and (jsonb_typeof(body) <> 'string' or not
      (entry_key in ('typelingo.mode','typelingo.daily-new','typelingo.selected-deck.v1','qiaoqiao.companion.v1')
       or entry_key like 'typelingo.deck-level.v1:%')) then raise exception 'invalid_sync_record'; end if;
    if entry_kind = 'review' and ((body->>'reviewedAt') is null
      or (body->>'reviewedAt')::timestamptz > now() + interval '5 minutes') then raise exception 'device_clock_ahead'; end if;
    insert into public.qiaoqiao_sync_receipts values(uid, (change->>'mutationId')::uuid) on conflict do nothing;
    get diagnostics inserted = row_count;
    if inserted = 0 then continue; end if;
    previous := null;
    select value into previous from public.qiaoqiao_sync_rows
      where user_id = uid and kind = entry_kind and key = entry_key;
    -- Review IDs are immutable. Receipts also prevent a retry of an older setting
    -- from overwriting a newer change accepted from another device.
    if previous is not null and (entry_kind = 'review' or previous = body) then continue; end if;
    if previous is not null and entry_kind = 'history' and
      (previous->>'completedAt') > (body->>'completedAt') then continue; end if;
    if previous is not null and entry_kind = 'seed' and
      (previous->>'updatedAt') >= (body->>'updatedAt') then continue; end if;
    current_version := current_version + 1;
    insert into public.qiaoqiao_sync_rows values(uid, entry_kind, entry_key, body, current_version)
      on conflict (user_id, kind, key) do update set value = excluded.value, version = excluded.version;
  end loop;
  if (select coalesce(sum(octet_length(value::text)), 0) from public.qiaoqiao_sync_rows where user_id = uid) > 52428800
    then raise exception 'account_sync_quota_exceeded'; end if;
  update public.qiaoqiao_sync_heads set version = current_version where user_id = uid;
end;
$$;

