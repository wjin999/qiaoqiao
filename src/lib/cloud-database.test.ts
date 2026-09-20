import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'

let db: PGlite
const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
async function login(id: string, role = 'authenticated') {
  await db.exec(`reset role; set role ${role};`)
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
}
async function push(value: unknown, mutationId = crypto.randomUUID(), kind = 'setting', key = 'typelingo.mode') {
  return db.query('select public.qiaoqiao_push($1::jsonb)', [JSON.stringify([{ kind, key, value, mutationId }])])
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    insert into auth.users values ('${a}'), ('${b}');`)
  await db.exec(readFileSync(new URL('../../supabase/migrations/202609200001_accounts_sync.sql', import.meta.url), 'utf8'))
  await db.exec(readFileSync(new URL('../../supabase/migrations/202609200002_companion_preferences.sql', import.meta.url), 'utf8'))
}, 30000)
afterAll(async () => { await db?.close() })

describe('Supabase migration under PostgreSQL', () => {
  it('denies anonymous RPC calls and direct table access', async () => {
    await login('', 'anon')
    await expect(db.query('select * from public.qiaoqiao_pull(0)')).rejects.toThrow('permission denied')
    await login(a)
    await expect(db.query('select * from public.qiaoqiao_sync_rows')).rejects.toThrow('permission denied')
  })
  it('isolates two users and rejects repeated stale mutations', async () => {
    await login(a)
    const first = crypto.randomUUID()
    await push('memory', first); await push('free'); await push('memory', first)
    const own = await db.query<{ value: string }>('select * from public.qiaoqiao_pull(0)')
    expect(own.rows[0]?.value).toBe('free')
    await login(b)
    expect((await db.query('select * from public.qiaoqiao_pull(0)')).rows).toEqual([])
    await push('memory')
    await login(a)
    expect((await db.query<{ value: string }>('select * from public.qiaoqiao_pull(0)')).rows[0]?.value).toBe('free')
  })
  it('keeps immutable reviews and rolls back a malformed batch', async () => {
    await login(a)
    const review = { id: 'r', reviewedAt: '2026-01-01T00:00:00.000Z', rating: 3 }
    await push(review, crypto.randomUUID(), 'review', 'r')
    await push({ ...review, rating: 1 }, crypto.randomUUID(), 'review', 'r')
    expect((await db.query<{ value: typeof review }>("select * from public.qiaoqiao_pull(0) where kind = 'review'")).rows[0]?.value.rating).toBe(3)
    const bad = [{ kind: 'setting', key: 'typelingo.mode', value: 'changed', mutationId: crypto.randomUUID() },
      { kind: 'skip', key: 'bad', value: 'not-a-boolean', mutationId: crypto.randomUUID() }]
    await expect(db.query('select public.qiaoqiao_push($1::jsonb)', [JSON.stringify(bad)])).rejects.toThrow('invalid_sync_record')
    expect((await db.query<{ value: string }>("select * from public.qiaoqiao_pull(0) where kind = 'setting'")).rows[0]?.value).toBe('free')
  })
  it('syncs companion preferences and preserves the companion attached to an immutable practice record', async () => {
    await login(a)
    const settings = JSON.stringify({ petId: 'mole', enabled: true, animations: true })
    await push(settings, crypto.randomUUID(), 'setting', 'qiaoqiao.companion.v1')
    const record = { id: 'pet-review', reviewedAt: '2026-01-01T00:00:00.000Z', rating: 1, petId: 'mole' }
    await push(record, crypto.randomUUID(), 'review', record.id)
    await push({ ...record, petId: 'sprout' }, crypto.randomUUID(), 'review', record.id)
    const rows = await db.query<{ key: string; value: any }>('select * from public.qiaoqiao_pull(0)')
    expect(rows.rows.find((row) => row.key === 'qiaoqiao.companion.v1')?.value).toBe(settings)
    expect(rows.rows.find((row) => row.key === record.id)?.value.petId).toBe('mole')
    await expect(push('x', crypto.randomUUID(), 'setting', 'unrecognized-setting')).rejects.toThrow('invalid_sync_record')
  })
  it('deletes only the requesting account and its cloud data', async () => {
    await login(a); await db.query('select public.qiaoqiao_delete_account()')
    await db.exec('reset role')
    expect((await db.query('select * from auth.users where id = $1', [a])).rows).toEqual([])
    expect((await db.query('select * from public.qiaoqiao_sync_rows where user_id = $1', [a])).rows).toEqual([])
    expect((await db.query('select * from public.qiaoqiao_sync_rows where user_id = $1', [b])).rows).toHaveLength(1)
  })
})
