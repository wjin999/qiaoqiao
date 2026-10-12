import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import eggRolls from '../data/egg-rolls.json'
import { jsonbTextBytes } from './sync-size'

let db: PGlite
const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const c = '33333333-3333-4333-8333-333333333333'
const d = '44444444-4444-4444-8444-444444444444'
const earlierMigrations = ['202609200001_accounts_sync.sql', '202609200002_companion_preferences.sql', '202610120001_resilient_sync.sql']
type PushResult = { mutationId: string; status: 'ok' | 'retry' | 'rejected'; error: string | null }
const migration = (file: string) => readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8')

async function login(id: string, role = 'authenticated', signedInSecondsAgo = 0) {
  await db.exec(`reset role; set role ${role};`)
  const claims = id ? { sub: id, amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - signedInSecondsAgo }] } : {}
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [id, JSON.stringify(claims)])
}
async function asAdmin<T>(work: () => Promise<T>) { await db.exec('reset role'); return work() }
async function push(value: unknown, mutationId = crypto.randomUUID(), kind = 'skip', key = 'sentence-1') {
  return db.query('select public.qiaoqiao_push($1::jsonb)', [JSON.stringify([{ kind, key, value, mutationId }])])
}
const change = (kind: string, key: string, value: unknown, mutationId: string = crypto.randomUUID()) => ({ kind, key, value, mutationId })
async function pushV2(changes: unknown[]) {
  return (await db.query<{ results: PushResult[] }>('select public.qiaoqiao_push_v2($1::jsonb) as results', [JSON.stringify(changes)])).rows[0]!.results
}
async function pulled() {
  return (await db.query<{ kind: string; key: string; value: any }>('select kind, key, value from public.qiaoqiao_pull(0)')).rows
}
async function setQuota(bytes: number) {
  await asAdmin(() => db.exec(`create or replace function public.qiaoqiao_account_quota()
    returns bigint language sql stable set search_path = '' as $$ select ${bytes}::bigint $$`))
}
async function usage(user: string) {
  return asAdmin(async () => {
    const head = (await db.query<{ bytes: number | string }>('select bytes from public.qiaoqiao_sync_heads where user_id = $1', [user])).rows[0]!
    const actual = (await db.query<{ bytes: number | string }>(
      'select coalesce(sum(octet_length(key) + octet_length(value::text)), 0) as bytes from public.qiaoqiao_sync_rows where user_id = $1', [user])).rows[0]!
    expect(Number(head.bytes)).toBe(Number(actual.bytes))
    return Number(head.bytes)
  })
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    $$;
    insert into auth.users values ('${a}'), ('${b}'), ('${c}'), ('${d}');`)
  for (const file of earlierMigrations) await db.exec(migration(file))
  // An account synced by an earlier version, which still uploaded settings and decks.
  await login(c)
  await pushV2([change('setting', 'typelingo.mode', 'free'), change('deck', 'old-deck', { id: 'old-deck', title: '导入卡组' }),
    change('review', 'kept', { id: 'kept', reviewedAt: '2026-01-01T00:00:00.000Z' })])
  await db.exec('reset role')
  await db.exec(migration('202610120002_learning_records_only.sql'))
}, 30000)
afterAll(async () => { await db?.close() })

describe('Supabase migration under PostgreSQL', () => {
  it('denies anonymous RPC calls, direct table access and internal helpers', async () => {
    await login('', 'anon')
    await expect(db.query('select * from public.qiaoqiao_pull(0)')).rejects.toThrow('permission denied')
    await expect(db.query("select public.qiaoqiao_push_v2('[]')")).rejects.toThrow('permission denied')
    await login(a)
    await expect(db.query('select * from public.qiaoqiao_sync_rows')).rejects.toThrow('permission denied')
    await expect(db.query("select public.qiaoqiao_try_timestamptz('2026-01-01')")).rejects.toThrow('permission denied')
  })
  it('removes cloud copies of settings and decks but keeps learning records', async () => {
    await login(c)
    expect((await pulled()).map((row) => `${row.kind}:${row.key}`)).toEqual(['review:kept'])
    expect(await usage(c)).toBeGreaterThan(0)
  })
  it('isolates two users and rejects repeated stale mutations', async () => {
    await login(a)
    const first = crypto.randomUUID()
    await push(true, first); await push(false); await push(true, first)
    expect((await pulled())[0]?.value).toBe(false)
    await login(b)
    expect(await pulled()).toEqual([])
    await push(true)
    await login(a)
    expect((await pulled())[0]?.value).toBe(false)
  })
  it('keeps immutable reviews and rolls back a malformed batch for pages loaded before the upgrade', async () => {
    await login(a)
    const review = { id: 'r', reviewedAt: '2026-01-01T00:00:00.000Z', rating: 3 }
    await push(review, crypto.randomUUID(), 'review', 'r')
    await push({ ...review, rating: 1 }, crypto.randomUUID(), 'review', 'r')
    expect((await pulled()).find((row) => row.kind === 'review')?.value.rating).toBe(3)
    const bad = [{ kind: 'skip', key: 'sentence-2', value: true, mutationId: crypto.randomUUID() },
      { kind: 'skip', key: 'bad', value: 'not-a-boolean', mutationId: crypto.randomUUID() }]
    await expect(db.query('select public.qiaoqiao_push($1::jsonb)', [JSON.stringify(bad)])).rejects.toThrow('invalid_sync_record')
    expect((await pulled()).some((row) => row.key === 'sentence-2')).toBe(false)
  })
  it('lets older pages upload settings and decks, storing nothing, and keeps companion records', async () => {
    await login(a)
    await push(JSON.stringify({ petId: 'golden', enabled: true }), crypto.randomUUID(), 'setting', 'qiaoqiao.companion.v1')
    await push('x', crypto.randomUUID(), 'setting', 'unrecognized-setting')
    await push({ id: 'deck-1', title: '旧卡组' }, crypto.randomUUID(), 'deck', 'deck-1')
    const record = { id: 'pet-review', reviewedAt: '2026-01-01T00:00:00.000Z', rating: 1, petId: 'golden' }
    await push(record, crypto.randomUUID(), 'review', record.id)
    await push({ ...record, petId: 'tuxedo' }, crypto.randomUUID(), 'review', record.id)
    const rows = await pulled()
    expect(rows.some((row) => row.kind === 'setting' || row.kind === 'deck')).toBe(false)
    expect(rows.find((row) => row.key === record.id)?.value.petId).toBe('golden')
  })
  it('reports every record separately and stores the valid ones', async () => {
    await login(d)
    const later = change('review', 'later', { id: 'later', reviewedAt: new Date(Date.now() + 3600_000).toISOString() })
    const results = await pushV2([
      change('skip', 'sentence-1', true),
      change('skip', 'bad', 'not-a-boolean'),
      later,
      change('history', 'huge', { id: 'huge', completedAt: '2026-01-01T00:00:00.000Z', note: 'x'.repeat(20000) }),
      change('setting', 'typelingo.mode', 'free'),
      change('deck', 'deck-1', { id: 'deck-1' }),
      change('review', 'now', { id: 'now', reviewedAt: new Date().toISOString() }),
      { kind: 'skip', key: 'no-mutation-id', value: true },
    ])
    expect(results.map((result) => [result.status, result.error])).toEqual([
      ['ok', null], ['rejected', 'invalid_sync_record'], ['retry', 'device_clock_ahead'], ['rejected', 'sync_record_too_large'],
      ['ok', null], ['ok', null], ['ok', null], ['rejected', 'invalid_sync_record'],
    ])
    expect(results[2]?.mutationId).toBe(later.mutationId)
    expect((await pulled()).map((row) => `${row.kind}:${row.key}`).sort()).toEqual(['review:now', 'skip:sentence-1'])
    // A deferred record leaves no receipt, so the same mutation is accepted once it is valid.
    const fixed = { ...later, value: { id: 'later', reviewedAt: new Date().toISOString() } }
    expect((await pushV2([fixed]))[0]?.status).toBe('ok')
  })
  it('accepts each mutation once and never lets an old retry overwrite a newer value', async () => {
    await login(d)
    const first = crypto.randomUUID()
    expect((await pushV2([change('skip', 'sentence-9', true, first)]))[0]?.status).toBe('ok')
    await pushV2([change('skip', 'sentence-9', false)])
    expect((await pushV2([change('skip', 'sentence-9', true, first)]))[0]).toMatchObject({ status: 'ok', error: null })
    expect((await pulled()).find((row) => row.key === 'sentence-9')?.value).toBe(false)
  })
  it('tracks account size incrementally, defers growth past the quota and lets smaller records free space', async () => {
    const big = { id: 'h-big', completedAt: '2026-01-01T00:00:00.000Z', note: 'x'.repeat(8000) }
    await login(d)
    await pushV2([change('history', big.id, big)])
    const before = await usage(d)
    await setQuota(before + 100)
    try {
      const growth = change('history', 'h-new', { id: 'h-new', completedAt: '2026-01-01T00:00:00.000Z', note: 'y'.repeat(500) })
      await login(d)
      expect((await pushV2([growth]))[0]).toMatchObject({ status: 'retry', error: 'account_sync_quota_exceeded' })
      expect((await pushV2([change('history', big.id, { ...big, completedAt: '2026-01-02T00:00:00.000Z', note: 'short' })]))[0]?.status).toBe('ok')
      expect(await usage(d)).toBeLessThan(before - 7000)
      await login(d)
      expect((await pushV2([growth]))[0]?.status).toBe('ok')
      expect(await usage(d)).toBeLessThanOrEqual(before + 100)
    } finally { await setQuota(52428800) }
  })
  it('forgets receipts after 30 days', async () => {
    const old = crypto.randomUUID()
    await asAdmin(() => db.query("insert into public.qiaoqiao_sync_receipts(user_id, mutation_id, created_at) values ($1, $2, now() - interval '31 days')", [d, old]))
    await login(d)
    await pushV2([change('skip', 'sentence-3', true)])
    expect((await asAdmin(() => db.query('select 1 from public.qiaoqiao_sync_receipts where mutation_id = $1', [old]))).rows).toEqual([])
  })
  it('measures records exactly like the server does', async () => {
    const samples: unknown[] = [eggRolls, 'plain', 12, 1.5, true, null, [[], [{}]],
      { list: [1, 2, { text: 'c,d:e' }], 'quote"key': 'back\\slash\n\t\u0001', rare: '𠮟る😀', empty: [], none: {} }]
    await asAdmin(async () => {
      for (const value of samples) {
        const json = JSON.stringify(value)
        const server = (await db.query<{ bytes: number }>('select octet_length($1::jsonb::text) as bytes', [json])).rows[0]!.bytes
        expect(jsonbTextBytes(json)).toBe(server)
      }
    })
  })
  it('deletes only the requesting account, and only right after a password sign-in', async () => {
    await login(a, 'authenticated', 20 * 60)
    await expect(db.query('select public.qiaoqiao_delete_account()')).rejects.toThrow('reauthentication_required')
    await login(a); await db.query('select public.qiaoqiao_delete_account()')
    await db.exec('reset role')
    expect((await db.query('select * from auth.users where id = $1', [a])).rows).toEqual([])
    expect((await db.query('select * from public.qiaoqiao_sync_rows where user_id = $1', [a])).rows).toEqual([])
    expect((await db.query('select * from public.qiaoqiao_sync_rows where user_id = $1', [b])).rows).toHaveLength(1)
  })
})
