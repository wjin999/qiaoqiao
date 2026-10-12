// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { setAccountScope } from './account-scope'
import { acknowledgeChanges, applyCloudRows, cloudCursor, deleteStoredDeck, exportProgress, loadQuarantine, loadSettings, loadStoredDecks,
  pendingChanges, recordReview, storeDeck, storeSetting, permanentlySkipSentence, clearPermanentlySkippedSentences, mergeProgress } from './storage'
import { cloudTransport, syncAccount, syncNotice, validCloudRow, type SyncTransport } from './cloud-sync'
import { jsonbTextBytes, SYNC_LIMITS } from './sync-size'
import type { Lesson } from '../types'
import { rebuildCards } from './reconcile'
import { reviewSentence, type ReviewEntry } from './scheduler'
import type { CloudMutation, CloudRow } from './cloud-types'

const item = { id: 'sentence', text: '猫', nativeText: '猫', ruby: [{ text: '猫' }] }
const review: ReviewEntry = { id: 'a:1', lessonId: 'deck', sentenceId: 'sentence', reviewedAt: '2026-09-20T01:00:00.000Z', mode: 'memory', rating: 3, hintUsed: false, elapsedMs: 1000 }
const history = { id: 'a', lessonId: 'deck', completedAt: review.reviewedAt, sentenceCount: 1, elapsedMs: 1000 }
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); localStorage.clear(); setAccountScope('account-a') })
afterEach(() => { setAccountScope(null); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('account synchronization', () => {
  it('queues settings for sync, restores them on another device, and isolates accounts', async () => {
    await storeSetting('typelingo.mode', 'free')
    const push = vi.fn(async (_changes: CloudMutation[]) => {})
    await syncAccount('account-a', { push, pull: async () => [] })
    expect(push.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'typelingo.mode', value: 'free' })]))
    setAccountScope('fresh-device')
    await syncAccount('fresh-device', { push: async () => {}, pull: async () => [{ kind: 'setting', key: 'typelingo.mode', value: 'free', version: 1 }] })
    expect((await loadSettings())['typelingo.mode']).toBe('free')
    setAccountScope('unrelated-account')
    expect((await loadSettings())['typelingo.mode']).toBeUndefined()
  })
  it('applies reviews and settings recorded on another device', async () => {
    const remote: ReviewEntry = { ...review, id: 'device-b:1', reviewedAt: '2026-09-20T02:00:00Z' }
    await recordReview(review, item, history)
    const rows: CloudRow[] = [
      { kind: 'review', key: remote.id, value: remote, version: 1 },
      { kind: 'setting', key: 'typelingo.daily-new', value: '20', version: 2 },
      { kind: 'review', key: review.id, value: review, version: 3 },
    ]
    expect(rows.every(validCloudRow)).toBe(true)
    await syncAccount('account-a', { push: async () => {}, pull: async () => rows })
    await syncAccount('account-a', { push: async () => {}, pull: async () => [] })
    expect((await exportProgress()).reviews).toHaveLength(2)
    expect((await loadSettings())['typelingo.daily-new']).toBe('20')
  })
  it('accepts records from the retired companion feature and ignores its setting', async () => {
    const local = { ...review, petId: 'golden' }
    const remote = { ...review, id: 'device-b:1', reviewedAt: '2026-09-20T02:00:00Z', petId: 'sparrow' }
    await recordReview(local, item, history)
    const rows: CloudRow[] = [
      { kind: 'review', key: remote.id, value: remote, version: 1 },
      { kind: 'setting', key: 'qiaoqiao.companion.v1', value: '{"petId":"tuxedo","enabled":true}', version: 2 },
      { kind: 'review', key: local.id, value: local, version: 3 },
    ]
    expect(rows.every(validCloudRow)).toBe(true)
    await syncAccount('account-a', { push: async () => {}, pull: async () => rows })
    expect((await exportProgress()).reviews).toEqual(expect.arrayContaining([local, remote]))
    expect((await exportProgress()).reviews).toHaveLength(2)
    expect((await loadSettings())['qiaoqiao.companion.v1']).toBeUndefined()
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
    await storeSetting('typelingo.mode', 'memory')
    const sent = await pendingChanges('account-a')
    await storeSetting('typelingo.mode', 'free')
    await acknowledgeChanges('account-a', sent)
    expect((await pendingChanges('account-a'))[0]?.value).toBe('free')
    await applyCloudRows('account-a', [{ kind: 'setting', key: 'typelingo.mode', value: 'memory', version: 1 }], 1)
    expect((await loadSettings())['typelingo.mode']).toBe('free')
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
    expect(validCloudRow({ kind: 'deck', key: 'x', value: { id: 'x', items: [{}] }, version: 1 })).toBe(false)
    const rows: CloudRow[] = [{ kind: 'review', key: review.id, value: review, version: 2 }, { kind: 'skip', key: 'a', value: true, version: 1 }]
    await expect(syncAccount('account-a', { push: async () => {}, pull: async () => rows })).rejects.toThrow('顺序')
    expect(await cloudCursor('account-a')).toBe(0)
  })
  it('sets aside rows this version cannot read, keeps syncing, and applies them once readable', async () => {
    const future: CloudRow = { kind: 'setting', key: 'typelingo.future-setting', value: 'on', version: 1 }
    const rows: CloudRow[] = [future, { kind: 'review', key: review.id, value: review, version: 2 }]
    const report = await syncAccount('account-a', { push: async () => {}, pull: async () => rows })
    expect(report).toMatchObject({ quarantined: 1, changed: { progress: true } })
    expect(await cloudCursor('account-a')).toBe(2)
    expect((await exportProgress()).reviews).toEqual([review])
    expect(await loadQuarantine('account-a')).toHaveLength(1)
    expect(syncNotice(report)).toContain('1 条云端记录需刷新网页后读取')
    // A later version that understands the row applies it from the quarantine.
    await applyCloudRows('account-a', await loadQuarantine('account-a'), null)
    expect((await loadSettings())['typelingo.future-setting']).toBe('on')
    expect(await loadQuarantine('account-a')).toEqual([])
    // A newer copy of a quarantined row replaces it instead of being overwritten later.
    await syncAccount('account-a', { push: async () => {}, pull: async () => [{ ...future, version: 3 }] })
    await syncAccount('account-a', { push: async () => {}, pull: async () => [{ kind: 'setting', key: 'typelingo.mode', value: 'free', version: 4 }] })
    expect(await loadQuarantine('account-a')).toHaveLength(1)
  })
  it('keeps syncing past changes the server rejects or defers', async () => {
    await storeSetting('typelingo.mode', 'free'); await storeSetting('typelingo.daily-new', '20'); await permanentlySkipSentence([], 'sentence')
    const pull = vi.fn(async () => [] as CloudRow[])
    const push = vi.fn(async (changes: CloudMutation[]) => changes.map((change) => ({ mutationId: change.mutationId,
      ...change.kind === 'skip' ? { status: 'rejected' as const, error: 'invalid_sync_record' }
        : change.key === 'typelingo.daily-new' ? { status: 'retry' as const, error: 'account_sync_quota_exceeded' } : { status: 'ok' as const } })))
    const report = await syncAccount('account-a', { push, pull })
    expect(report).toMatchObject({ retry: 1, rejected: 1 })
    expect(pull).toHaveBeenCalled()
    expect((await pendingChanges('account-a')).map((change) => change.key)).toEqual(['typelingo.daily-new'])
    expect(syncNotice(report)).toContain('云端容量已满')
  })
  it('still receives other devices’ records when uploading fails', async () => {
    await storeSetting('typelingo.mode', 'free')
    const rows: CloudRow[] = [{ kind: 'review', key: review.id, value: review, version: 1 }]
    await expect(syncAccount('account-a', { push: async () => { throw new Error('upload failed') }, pull: async () => rows })).rejects.toThrow('upload failed')
    expect((await exportProgress()).reviews).toEqual([review])
    expect(await cloudCursor('account-a')).toBe(1)
    expect(await pendingChanges('account-a')).toHaveLength(1)
  })
  it('keeps a deck the server would refuse on this device instead of uploading it', async () => {
    const deck: Lesson = { schemaVersion: 2, id: 'big', title: '大卡组', nativeLanguage: 'zh-CN', targetLanguage: 'ja',
      items: Array.from({ length: 40 }, (_, index) => ({ id: `big:${index}`, text: '猫', nativeText: '猫', ruby: [{ text: '猫', reading: 'ねこ' }] })) }
    await storeDeck(deck); await storeSetting('typelingo.mode', 'free')
    const json = JSON.stringify(deck), limit = SYNC_LIMITS.deckBytes
    // Small enough by JSON.stringify, too large as the server measures it (jsonb adds ", " and ": ").
    SYNC_LIMITS.deckBytes = new TextEncoder().encode(json).length + 5
    try {
      expect(jsonbTextBytes(json)).toBeGreaterThan(SYNC_LIMITS.deckBytes)
      const push = vi.fn(async (_changes: CloudMutation[]) => {})
      const report = await syncAccount('account-a', { push, pull: async () => [] })
      expect(push.mock.calls.flatMap(([changes]) => changes).map((change) => change.kind)).toEqual(['setting'])
      expect(report).toMatchObject({ rejected: 1, reasons: ['sync_record_too_large'] })
      expect(await pendingChanges('account-a')).toEqual([])
      expect((await loadStoredDecks()).map((saved) => saved.id)).toEqual(['big'])
    } finally { SYNC_LIMITS.deckBytes = limit }
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
  it('deletes a deck on every device through a tombstone', async () => {
    const deck: Lesson = { schemaVersion: 2, id: 'old-import', title: '旧导入', nativeLanguage: 'zh-CN', targetLanguage: 'ja',
      items: [{ id: 'old-import:1', text: '猫', nativeText: '猫', ruby: [{ text: '猫' }] }] }
    await storeDeck(deck); await deleteStoredDeck(deck.id)
    expect(await loadStoredDecks()).toEqual([])
    expect((await pendingChanges('account-a')).map((change) => change.value)).toEqual([{ id: deck.id, deleted: true }])
    setAccountScope('other-device')
    await applyCloudRows('other-device', [{ kind: 'deck', key: deck.id, value: deck, version: 1 }], 1)
    expect(await loadStoredDecks()).toHaveLength(1)
    const tombstone: CloudRow = { kind: 'deck', key: deck.id, value: { id: deck.id, deleted: true }, version: 2 }
    expect(validCloudRow(tombstone)).toBe(true)
    await applyCloudRows('other-device', [tombstone], 2)
    expect(await loadStoredDecks()).toEqual([])
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
