// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { setAccountScope } from './account-scope'
import { acknowledgeChanges, applyCloudRows, cloudCursor, exportProgress, loadSettings, pendingChanges,
  recordReview, storeSetting, permanentlySkipSentence, clearPermanentlySkippedSentences, mergeProgress } from './storage'
import { syncAccount, validCloudRow, type SyncTransport } from './cloud-sync'
import { rebuildCards } from './reconcile'
import { reviewSentence, type ReviewEntry } from './scheduler'
import type { CloudMutation, CloudRow } from './cloud-types'
import { companionPreferences, petGrowth, PET_PREFERENCE_KEY } from './companions'

const item = { id: 'sentence', text: '猫', nativeText: '猫', ruby: [{ text: '猫' }] }
const review: ReviewEntry = { id: 'a:1', lessonId: 'deck', sentenceId: 'sentence', reviewedAt: '2026-09-20T01:00:00.000Z', mode: 'memory', rating: 3, hintUsed: false, elapsedMs: 1000 }
const history = { id: 'a', lessonId: 'deck', completedAt: review.reviewedAt, sentenceCount: 1, elapsedMs: 1000 }
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); localStorage.clear(); setAccountScope('account-a') })
afterEach(() => { setAccountScope(null); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('account synchronization', () => {
  it('queues both outfits for sync, restores them on another device, and isolates accounts', async () => {
    const wardrobe = JSON.stringify({ petId: 'golden', enabled: true, animations: true, outfits: { golden: 'explorer', tuxedo: 'varsity' } })
    await storeSetting(PET_PREFERENCE_KEY, wardrobe)
    const push = vi.fn(async (_changes: CloudMutation[]) => {})
    await syncAccount('account-a', { push, pull: async () => [] })
    expect(push.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ key: PET_PREFERENCE_KEY, value: wardrobe })]))
    setAccountScope('fresh-device')
    await syncAccount('fresh-device', { push: async () => {}, pull: async () => [{ kind: 'setting', key: PET_PREFERENCE_KEY, value: wardrobe, version: 1 }] })
    expect(companionPreferences((await loadSettings())[PET_PREFERENCE_KEY]!).outfits).toEqual({ golden: 'explorer', tuxedo: 'varsity' })
    setAccountScope('unrelated-account')
    expect((await loadSettings())[PET_PREFERENCE_KEY]).toBeUndefined()
  })
  it('merges golden retriever and cat growth from two devices and remembers the chosen cat', async () => {
    const local: ReviewEntry = { ...review, petId: 'golden' }
    const remote: ReviewEntry = { ...review, id: 'device-b:1', reviewedAt: '2026-09-20T02:00:00Z', petId: 'tuxedo' }
    await recordReview(local, item, history)
    const rows: CloudRow[] = [
      { kind: 'review', key: remote.id, value: remote, version: 1 },
      { kind: 'setting', key: PET_PREFERENCE_KEY, value: '{"petId":"tuxedo","enabled":true,"animations":false}', version: 2 },
      { kind: 'review', key: local.id, value: local, version: 3 },
    ]
    expect(rows.every(validCloudRow)).toBe(true)
    await syncAccount('account-a', { push: async () => {}, pull: async () => rows })
    await syncAccount('account-a', { push: async () => {}, pull: async () => [] })
    expect(petGrowth((await exportProgress()).reviews)).toEqual({ golden: 1, tuxedo: 1 })
    expect((await loadSettings())[PET_PREFERENCE_KEY]).toContain('tuxedo')
  })
  it('continues syncing legacy companion records without duplication or account leakage', async () => {
    const local: ReviewEntry = { ...review, petId: 'mole' }
    const remote: ReviewEntry = { ...review, id: 'device-b:1', reviewedAt: '2026-09-20T02:00:00Z', petId: 'sparrow' }
    await recordReview(local, item, history)
    const rows: CloudRow[] = [
      { kind: 'review', key: remote.id, value: remote, version: 1 },
      { kind: 'setting', key: PET_PREFERENCE_KEY, value: '{"petId":"sprout","enabled":true,"animations":false}', version: 2 },
      { kind: 'review', key: local.id, value: local, version: 3 },
    ]
    expect(rows.every(validCloudRow)).toBe(true)
    const transport: SyncTransport = { push: async () => {}, pull: async () => rows }
    await syncAccount('account-a', transport)
    await syncAccount('account-a', { push: async () => {}, pull: async () => [] })
    expect((await exportProgress()).reviews).toEqual(expect.arrayContaining([local, remote]))
    expect((await exportProgress()).reviews).toHaveLength(2)
    expect((await loadSettings())[PET_PREFERENCE_KEY]).toContain('sprout')
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
  it('rejects malformed remote data before advancing the cursor', async () => {
    expect(validCloudRow({ kind: 'deck', key: 'x', value: { id: 'x', items: [{}] }, version: 1 })).toBe(false)
    const transport: SyncTransport = { push: async () => {}, pull: async () => [{ kind: 'review', key: 'wrong', value: review, version: 1 }] }
    await expect(syncAccount('account-a', transport)).rejects.toThrow('格式')
    expect(await cloudCursor('account-a')).toBe(0)
  })
})
