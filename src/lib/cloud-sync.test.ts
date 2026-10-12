// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { setAccountScope } from './account-scope'
import { acknowledgeChanges, applyCloudRows, cloudCursor, exportProgress, loadPermanentlySkippedSentenceIds, loadQuarantine, loadSettings,
  pendingChanges, recordReview, storeSetting, permanentlySkipSentence, clearPermanentlySkippedSentences, mergeProgress } from './storage'
import { cloudTransport, syncAccount, syncNotice, validCloudRow, type SyncTransport } from './cloud-sync'
import { jsonbTextBytes, SYNC_LIMITS } from './sync-size'
import { rebuildCards } from './reconcile'
import { reviewSentence, type ReviewEntry } from './scheduler'
import type { CloudMutation, CloudRow } from './cloud-types'

const item = { id: 'sentence', text: '猫', nativeText: '猫', ruby: [{ text: '猫' }] }
const review: ReviewEntry = { id: 'a:1', lessonId: 'deck', sentenceId: 'sentence', reviewedAt: '2026-09-20T01:00:00.000Z', mode: 'memory', rating: 3, hintUsed: false, elapsedMs: 1000 }
const history = { id: 'a', lessonId: 'deck', completedAt: review.reviewedAt, sentenceCount: 1, elapsedMs: 1000 }
// Rows and queue entries of kinds earlier versions synced (settings, decks).
const legacy = (row: object) => row as unknown as CloudRow
async function queueLegacyChange(change: object) {
  await loadSettings() // Creates the account database at the current version.
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('typelingo.progress.account.account-a')
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
  })
  await new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite'); tx.objectStore('outbox').put(change)
    tx.oncomplete = resolve; tx.onabort = reject
  })
  db.close()
}
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); localStorage.clear(); setAccountScope('account-a') })
afterEach(() => { setAccountScope(null); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('account synchronization', () => {
  it('uploads learning records only and keeps settings on this device', async () => {
    await storeSetting('typelingo.mode', 'free')
    await recordReview(review, item, history)
    const push = vi.fn(async (_changes: CloudMutation[]) => {})
    await syncAccount('account-a', { push, pull: async () => [] })
    expect(push.mock.calls.flatMap(([changes]) => changes).map((change) => change.kind).sort()).toEqual(['history', 'review'])
    expect((await loadSettings())['typelingo.mode']).toBe('free')
    setAccountScope('other-device')
    expect((await loadSettings())['typelingo.mode']).toBeUndefined()
  })
  it('drops settings and decks queued by earlier versions without uploading them', async () => {
    await queueLegacyChange({ id: '["setting","typelingo.mode"]', kind: 'setting', key: 'typelingo.mode', value: 'free', mutationId: crypto.randomUUID() })
    await queueLegacyChange({ id: '["deck","old"]', kind: 'deck', key: 'old', value: { id: 'old' }, mutationId: crypto.randomUUID() })
    await permanentlySkipSentence([], 'sentence')
    const push = vi.fn(async (_changes: CloudMutation[]) => {})
    await syncAccount('account-a', { push, pull: async () => [] })
    expect(push.mock.calls.flatMap(([changes]) => changes).map((change) => change.kind)).toEqual(['skip'])
    expect(await pendingChanges('account-a')).toEqual([])
  })
  it('ignores settings and decks that earlier versions stored in the cloud', async () => {
    const rows: CloudRow[] = [
      legacy({ kind: 'setting', key: 'typelingo.daily-new', value: '20', version: 1 }),
      legacy({ kind: 'deck', key: 'old', value: { id: 'old' }, version: 2 }),
      { kind: 'review', key: review.id, value: review, version: 3 },
    ]
    const report = await syncAccount('account-a', { push: async () => {}, pull: async () => rows })
    expect(report).toMatchObject({ changed: true, quarantined: 0 })
    expect((await exportProgress()).reviews).toEqual([review])
    expect(await loadSettings()).toEqual({})
    expect(await cloudCursor('account-a')).toBe(3)
  })
  it('applies reviews recorded on another device', async () => {
    const remote: ReviewEntry = { ...review, id: 'device-b:1', reviewedAt: '2026-09-20T02:00:00Z' }
    await recordReview(review, item, history)
    const rows: CloudRow[] = [
      { kind: 'review', key: remote.id, value: remote, version: 1 },
      { kind: 'review', key: review.id, value: review, version: 2 },
    ]
    expect(rows.every(validCloudRow)).toBe(true)
    await syncAccount('account-a', { push: async () => {}, pull: async () => rows })
    await syncAccount('account-a', { push: async () => {}, pull: async () => [] })
    expect((await exportProgress()).reviews).toHaveLength(2)
  })
  it('accepts records from the retired companion feature', async () => {
    const local = { ...review, petId: 'golden' }
    const remote = { ...review, id: 'device-b:1', reviewedAt: '2026-09-20T02:00:00Z', petId: 'sparrow' }
    await recordReview(local, item, history)
    const rows: CloudRow[] = [
      { kind: 'review', key: remote.id, value: remote, version: 1 },
      legacy({ kind: 'setting', key: 'qiaoqiao.companion.v1', value: '{"petId":"tuxedo","enabled":true}', version: 2 }),
      { kind: 'review', key: local.id, value: local, version: 3 },
    ]
    await syncAccount('account-a', { push: async () => {}, pull: async () => rows })
    expect((await exportProgress()).reviews).toEqual(expect.arrayContaining([local, remote]))
    expect((await exportProgress()).reviews).toHaveLength(2)
    expect(await cloudCursor('account-a')).toBe(3)
    setAccountScope('account-b')
    expect((await exportProgress()).reviews).toEqual([])
  })
  it('isolates guest, account A and account B without erasing any records', async () => {
    setAccountScope(null); await recordReview(review, item, history)
    setAccountScope('account-a'); expect((await exportProgress()).reviews).toEqual([])
    await mergeProgress(await exportProgress(null))
    expect((await exportProgress()).reviews).toHaveLength(1)
    setAccountScope('account-b'); expect((await exportProgress()).reviews).toEqual([])
    expect((await exportProgress(null)).reviews).toHaveLength(1)
  })
  it('rolls back the review if its upload queue cannot be persisted', async () => {
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'outbox') throw new Error('disk full')
      return put.apply(this, args)
    })
    await expect(recordReview(review, item, history)).rejects.toThrow()
    expect((await exportProgress()).reviews).toEqual([])
    expect(await pendingChanges('account-a')).toEqual([])
  })
  it('acknowledges only the uploaded mutation, preserving edits made during upload', async () => {
    await permanentlySkipSentence([], 'sentence')
    const sent = await pendingChanges('account-a')
    await clearPermanentlySkippedSentences(['sentence'])
    await acknowledgeChanges('account-a', sent)
    expect((await pendingChanges('account-a'))[0]?.value).toBe(false)
    await applyCloudRows('account-a', [{ kind: 'skip', key: 'sentence', value: true, version: 1 }], 1)
    expect(await loadPermanentlySkippedSentenceIds()).toEqual([])
  })
  it('preserves a cancellation of a permanent skip as an explicit mutation', async () => {
    await permanentlySkipSentence([], 'sentence')
    await acknowledgeChanges('account-a', await pendingChanges('account-a'))
    await clearPermanentlySkippedSentences(['sentence'])
    expect((await pendingChanges('account-a'))[0]?.value).toBe(false)
  })
  it('merges concurrent attempts into the same reproducible FSRS schedule', async () => {
    const other: ReviewEntry = { ...review, id: 'b:1', reviewedAt: '2026-09-20T02:00:00.000Z', rating: 1 }
    await recordReview(review, item, history)
    await applyCloudRows('account-a', [{ kind: 'review', key: other.id, value: other, version: 1 }], 1)
    const progress = await exportProgress()
    expect(progress.reviews).toHaveLength(2)
    expect(progress.cards).toEqual(rebuildCards([other, review], []))
    expect(progress.cards[0]?.card.reps).toBe(2)
    await applyCloudRows('account-a', [{ kind: 'review', key: other.id, value: other, version: 1 }], 1)
    expect((await exportProgress()).cards).toEqual(progress.cards)
  })
  it('keeps an imported checkpoint when its old review history is incomplete', async () => {
    const seed = reviewSentence(undefined, 'deck', item, 3, new Date(review.reviewedAt))
    const next = { ...review, id: 'later', reviewedAt: '2026-09-20T02:00:00.000Z' }
    const rows: CloudRow[] = [
      { kind: 'seed', key: seed.id, value: seed, version: 1 },
      { kind: 'review', key: next.id, value: next, version: 2 },
    ]
    await applyCloudRows('account-a', rows, 2)
    expect((await exportProgress()).cards[0]?.card.reps).toBe(2)
  })
  it('accepts a valid score after another tab has updated the sentence', async () => {
    await recordReview(review, item, history)
    const next = { ...review, id: 'tab-b', reviewedAt: '2026-09-20T02:00:00.000Z' }
    await recordReview(next, item, { ...history, id: 'b' }, undefined)
    expect((await exportProgress()).cards[0]?.card.reps).toBe(2)
    expect((await exportProgress()).reviews).toHaveLength(2)
  })
  it('retains pending data after network failure and retries without losing it', async () => {
    await recordReview(review, item, history)
    const transport: SyncTransport = { push: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined), pull: vi.fn().mockResolvedValue([]) }
    await expect(syncAccount('account-a', transport)).rejects.toThrow('offline')
    expect(await pendingChanges('account-a')).toHaveLength(2)
    await syncAccount('account-a', transport)
    expect(await pendingChanges('account-a')).toEqual([])
    expect((await exportProgress()).reviews).toHaveLength(1)
  })
  it('does not apply an in-flight response after switching accounts', async () => {
    const transport: SyncTransport = { push: async () => {}, pull: async () => {
      setAccountScope('account-b')
      return [{ kind: 'review', key: review.id, value: review, version: 1 }]
    } }
    await syncAccount('account-a', transport)
    expect((await exportProgress()).reviews).toEqual([])
    expect(await cloudCursor('account-a')).toBe(0)
  })
  it('rejects an out-of-order server response before advancing the cursor', async () => {
    const rows: CloudRow[] = [{ kind: 'review', key: review.id, value: review, version: 2 }, { kind: 'skip', key: 'a', value: true, version: 1 }]
    await expect(syncAccount('account-a', { push: async () => {}, pull: async () => rows })).rejects.toThrow('顺序')
    expect(await cloudCursor('account-a')).toBe(0)
  })
  it('sets aside rows this version cannot read, keeps syncing, and applies them once readable', async () => {
    const future = legacy({ kind: 'note', key: 'n1', value: { id: 'n1' }, version: 1 })
    const report = await syncAccount('account-a', { push: async () => {}, pull: async () => [future, { kind: 'review', key: review.id, value: review, version: 2 }] })
    expect(report).toMatchObject({ quarantined: 1, changed: true })
    expect(await cloudCursor('account-a')).toBe(2)
    expect((await exportProgress()).reviews).toEqual([review])
    expect(syncNotice(report)).toContain('1 条云端记录需刷新网页后读取')
    // A newer copy of a quarantined row replaces the older one.
    await syncAccount('account-a', { push: async () => {}, pull: async () => [{ ...future, version: 3 }] })
    expect((await loadQuarantine('account-a')).map((row) => row.version)).toEqual([3])
    // A later version that understands the row takes it out of the quarantine.
    await applyCloudRows('account-a', await loadQuarantine('account-a'), null)
    expect(await loadQuarantine('account-a')).toEqual([])
  })
  it('keeps syncing past changes the server rejects or defers', async () => {
    await recordReview(review, item, history); await permanentlySkipSentence([], 'sentence')
    const pull = vi.fn(async () => [] as CloudRow[])
    const push = vi.fn(async (changes: CloudMutation[]) => changes.map((change) => ({ mutationId: change.mutationId,
      ...change.kind === 'skip' ? { status: 'rejected' as const, error: 'invalid_sync_record' }
        : change.kind === 'history' ? { status: 'retry' as const, error: 'account_sync_quota_exceeded' } : { status: 'ok' as const } })))
    const report = await syncAccount('account-a', { push, pull })
    expect(report).toMatchObject({ retry: 1, rejected: 1 })
    expect(pull).toHaveBeenCalled()
    expect((await pendingChanges('account-a')).map((change) => change.kind)).toEqual(['history'])
    expect(syncNotice(report)).toContain('云端容量已满')
  })
  it('still receives other devices’ records when uploading fails', async () => {
    await permanentlySkipSentence([], 'sentence')
    const rows: CloudRow[] = [{ kind: 'review', key: review.id, value: review, version: 1 }]
    await expect(syncAccount('account-a', { push: async () => { throw new Error('upload failed') }, pull: async () => rows })).rejects.toThrow('upload failed')
    expect((await exportProgress()).reviews).toEqual([review])
    expect(await cloudCursor('account-a')).toBe(1)
    expect(await pendingChanges('account-a')).toHaveLength(1)
  })
  it('keeps a record the server would refuse on this device instead of uploading it', async () => {
    const long = { ...history, id: 'long', lessonTitle: 'x'.repeat(200) }
    await recordReview({ ...review, id: 'long:0' }, item, long)
    const json = JSON.stringify(long), limit = SYNC_LIMITS.recordBytes
    // Small enough by JSON.stringify, too large as the server measures it (jsonb adds ", " and ": ").
    SYNC_LIMITS.recordBytes = new TextEncoder().encode(json).length + 2
    try {
      expect(jsonbTextBytes(json)).toBeGreaterThan(SYNC_LIMITS.recordBytes)
      const push = vi.fn(async (_changes: CloudMutation[]) => {})
      const report = await syncAccount('account-a', { push, pull: async () => [] })
      expect(push.mock.calls.flatMap(([changes]) => changes).map((change) => change.kind)).toEqual(['review'])
      expect(report).toMatchObject({ rejected: 1, reasons: ['sync_record_too_large'] })
      expect(await pendingChanges('account-a')).toEqual([])
      expect((await exportProgress()).history).toEqual([long])
    } finally { SYNC_LIMITS.recordBytes = limit }
  })
  it('rebuilds only the schedules a pulled page touches', async () => {
    const other = { ...item, id: 'other' }
    await recordReview(review, item, history)
    await recordReview({ ...review, id: 'a:2', sentenceId: 'other' }, other, history)
    const untouched = (await exportProgress()).cards.find((card) => card.sentenceId === 'other')!
    await mergeProgress({ history: [], permanentlySkippedSentenceIds: [], reviews: [],
      cards: [{ ...untouched, updatedAt: '2026-09-20T05:00:00.000Z', card: { ...untouched.card, last_review: '2026-09-20T05:00:00.000Z' }, marker: true } as never] })
    const remote: ReviewEntry = { ...review, id: 'device-b:1', reviewedAt: '2026-09-20T03:00:00.000Z' }
    await applyCloudRows('account-a', [{ kind: 'review', key: remote.id, value: remote, version: 1 }], 1)
    const cards = (await exportProgress()).cards
    expect(cards.find((card) => card.sentenceId === 'sentence')?.card.reps).toBe(2)
    expect(cards.find((card) => card.sentenceId === 'other')).toHaveProperty('marker', true)
  })
  it('falls back to all-or-nothing uploads until the database is migrated', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url.slice(url.lastIndexOf('/') + 1))
      return url.endsWith('qiaoqiao_push_v2')
        ? new Response(JSON.stringify({ code: 'PGRST202', message: 'Could not find the function' }), { status: 404 })
        : new Response(null, { status: 204 })
    }))
    const transport = cloudTransport('token')
    expect(await transport.push([])).toBeUndefined()
    await transport.push([])
    expect(calls).toEqual(['qiaoqiao_push_v2', 'qiaoqiao_push', 'qiaoqiao_push'])
  })
})
