import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { addHistoryEntry, clearPermanentlySkippedSentences, exportProgress, historyCount, loadHistory, loadPermanentlySkippedSentenceIds,
  pendingChanges, permanentlySkipSentence, recordReview, HISTORY_KEY, PERMANENTLY_SKIPPED_KEY } from './storage'
import type { HistoryEntry, LessonItem } from '../types'
import type { ReviewEntry } from './scheduler'

const values = new Map<string, string>()
const history: HistoryEntry = { id: 'session', completedAt: '2026-09-13T01:00:00.000Z',
  lessonId: 'deck', sentenceCount: 1, elapsedMs: 1000 }
const item: LessonItem = { id: 'sentence', text: '猫', nativeText: '猫', ruby: [{ text: '猫', reading: 'ねこ' }] }
const review: ReviewEntry = { id: 'review', lessonId: 'deck', sentenceId: item.id,
  reviewedAt: history.completedAt, mode: 'memory', rating: 3, hintUsed: false, elapsedMs: 1000 }

beforeEach(() => {
  values.clear()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('durable learning records', () => {
  it('migrates valid legacy data once and does not resurrect cleared skips', async () => {
    values.set(HISTORY_KEY, JSON.stringify([history, { ...history, id: 'invalid', completedAt: 'invalid' }]))
    values.set(PERMANENTLY_SKIPPED_KEY, JSON.stringify(['sentence']))
    expect(await loadHistory()).toEqual([history])
    expect(await loadPermanentlySkippedSentenceIds()).toEqual(['sentence'])
    await clearPermanentlySkippedSentences()
    expect(await loadPermanentlySkippedSentenceIds()).toEqual([])
    expect(values.has(HISTORY_KEY)).toBe(true)
  })

  it('retains all records and pages them without losing parallel writes', async () => {
    await Promise.all(Array.from({ length: 35 }, (_, index) => addHistoryEntry([], {
      ...history, id: `session-${index}`, completedAt: new Date(Date.parse(history.completedAt) + index * 1000).toISOString(),
    })))
    expect(await historyCount()).toBe(35)
    expect((await loadHistory(5, 30)).map((entry) => entry.id)).toEqual(['session-4', 'session-3', 'session-2', 'session-1', 'session-0'])
    expect((await exportProgress()).history).toHaveLength(35)
  })

  it('persists sentence rating, schedule and partial session atomically and deduplicates retries', async () => {
    const card = await recordReview(review, item, { ...history, partial: true })
    await recordReview(review, item, history)
    const saved = await exportProgress()
    expect(saved.cards).toEqual([card])
    expect(saved.reviews).toEqual([review])
    expect(saved.history[0]?.partial).toBe(true)
    expect(saved.cards[0]?.card.reps).toBe(1)
  })

  it('rejects a stale second tab without adding a review or replacing history', async () => {
    await recordReview(review, item, history)
    await expect(recordReview({ ...review, id: 'stale-review' }, item, { ...history, id: 'stale-session' })).rejects.toThrow('其他页面')
    const data = await exportProgress()
    expect(data.reviews).toHaveLength(1)
    expect(data.history).toHaveLength(1)
  })

  it('rolls back the card and history when the review log cannot be saved', async () => {
    await loadHistory()
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'reviews') throw new DOMException('Full', 'QuotaExceededError')
      return put.call(this, value, key)
    })
    await expect(recordReview(review, item, history)).rejects.toThrow('未能保存')
    expect(await exportProgress()).toEqual({ cards: [], reviews: [], history: [], permanentlySkippedSentenceIds: [] })
  })

  it('free typing saves an attempt without changing memory state', async () => {
    await recordReview({ ...review, mode: 'free', rating: null }, item, history)
    const data = await exportProgress()
    expect(data.cards).toEqual([])
    expect(data.reviews).toHaveLength(1)
  })

  it('never queues guest changes and drops the queue older versions left behind', async () => {
    // Version 2 of the database queued guest changes that were never uploaded.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('typelingo.progress', 2)
      request.onupgradeneeded = () => {
        for (const name of ['history', 'cards', 'reviews', 'skips', 'meta', 'outbox', 'settings', 'decks', 'seeds']) request.result.createObjectStore(name, { keyPath: 'id' })
      }
      request.onsuccess = () => {
        const tx = request.result.transaction('outbox', 'readwrite')
        tx.objectStore('outbox').put({ id: 'stale', kind: 'review', key: 'stale', value: {}, mutationId: 'stale' })
        tx.oncomplete = () => { request.result.close(); resolve() }
        tx.onabort = () => reject(tx.error)
      }
    })
    await recordReview(review, item, history)
    await permanentlySkipSentence([], 'sentence')
    expect(await pendingChanges(null)).toEqual([])
    expect((await exportProgress()).reviews).toEqual([review])
  })

  it('opens the database once for many reads and writes', async () => {
    const open = vi.spyOn(indexedDB, 'open')
    await loadHistory(); await recordReview(review, item, history); await exportProgress(); await historyCount()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('restores one deck without removing another deck or resurrecting stale skips', async () => {
    await permanentlySkipSentence([], 'a:1')
    await permanentlySkipSentence([], 'b:1')
    expect(await clearPermanentlySkippedSentences(['a:1'])).toEqual(['b:1'])
    expect(await permanentlySkipSentence(['a:1'], 'a:2')).toEqual(['a:2', 'b:1'])
  })
})
