import type { HistoryEntry, LessonItem } from '../types'
import { reviewSentence, sentenceKey, type ReviewEntry, type SentenceProgress } from './scheduler'
import { getAccountScope, scopedDatabase, notifyLocalChange, CLOUD_APPLIED } from './account-scope'
import { cloudKey, type CloudKind, type CloudMutation, type CloudRow } from './cloud-types'
import type { Lesson } from '../types'
import { rebuildCards } from './reconcile'

export const HISTORY_KEY = 'typelingo.history.ja.v2'
export const PERMANENTLY_SKIPPED_KEY = 'typelingo.skipped-sentences.ja.v1'
export const PROGRESS_UPDATED_KEY = 'typelingo.progress.updated.v3'
export const PROGRESS_DATABASE = 'typelingo.progress'
const STORES = ['history', 'cards', 'reviews', 'skips', 'meta', 'outbox', 'settings', 'decks', 'seeds']
export interface ProgressData {
  history: HistoryEntry[]
  permanentlySkippedSentenceIds: string[]
  cards: SentenceProgress[]
  reviews: ReviewEntry[]
}

export function validHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as HistoryEntry
  return typeof entry.id === 'string' && !!entry.id && typeof entry.lessonId === 'string' && !!entry.lessonId
    && typeof entry.completedAt === 'string' && Number.isFinite(Date.parse(entry.completedAt))
    && Number.isSafeInteger(entry.sentenceCount) && entry.sentenceCount >= 0
    && Number.isFinite(entry.elapsedMs) && entry.elapsedMs >= 0
    && (entry.lessonTitle === undefined || typeof entry.lessonTitle === 'string')
    && (entry.mode === undefined || entry.mode === 'memory' || entry.mode === 'free')
    && (entry.partial === undefined || typeof entry.partial === 'boolean')
}

function legacyValues(key: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function openDatabase(account = getAccountScope()): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(scopedDatabase(PROGRESS_DATABASE, account), 2)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
      const history = request.transaction!.objectStore('history')
      if (!history.indexNames.contains('completedAt')) history.createIndex('completedAt', 'completedAt')
    }
    request.onerror = () => reject(new Error('无法读取学习记录，请检查浏览器是否允许本地存储。'))
    request.onblocked = () => reject(new Error('请关闭其他日语敲敲页面后重试。'))
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      const tx = db.transaction(['meta', 'history', 'skips'], 'readwrite')
      const marker = tx.objectStore('meta').get('legacy-migrated')
      marker.onsuccess = () => {
        if (marker.result) return
        if (account) { tx.objectStore('meta').put({ id: 'legacy-migrated' }); return }
        for (const entry of legacyValues(HISTORY_KEY).filter(validHistoryEntry)) tx.objectStore('history').put(entry)
        for (const id of legacyValues(PERMANENTLY_SKIPPED_KEY)) {
          if (typeof id === 'string') tx.objectStore('skips').put({ id })
        }
        tx.objectStore('meta').put({ id: 'legacy-migrated' })
      }
      tx.oncomplete = () => resolve(db)
      tx.onabort = () => { db.close(); reject(new Error('旧进度迁移失败，原数据已保留，请重试。')) }
    }
  })
}

function announce() {
  try { window.localStorage.setItem(PROGRESS_UPDATED_KEY, crypto.randomUUID()) } catch { /* IndexedDB is authoritative. */ }
}

async function transaction<T>(names: string[], mode: IDBTransactionMode,
  work: (tx: IDBTransaction, result: (value: T) => void, fail: (message: string) => void) => void,
  account = getAccountScope(), silent = false): Promise<T> {
  const db = await openDatabase(account)
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...new Set([...names, ...(mode === 'readwrite' ? ['outbox'] : [])])], mode)
    let value: T
    let message = '学习记录未能保存，请检查浏览器存储空间后重试。'
    tx.oncomplete = () => { db.close(); if (mode === 'readwrite' && !silent) { announce(); if (account === getAccountScope()) notifyLocalChange() }; resolve(value) }
    tx.onabort = () => { db.close(); reject(new Error(message)) }
    try { work(tx, (next) => { value = next }, (reason) => { message = reason; tx.abort() }) }
    catch { tx.abort() }
  })
}

function enqueue(tx: IDBTransaction, kind: CloudKind, key: string, value: unknown) {
  tx.objectStore('outbox').put({ id: cloudKey(kind, key), kind, key, value, mutationId: crypto.randomUUID() } satisfies CloudMutation)
}

export async function loadHistory(limit = 5, offset = 0): Promise<HistoryEntry[]> {
  return transaction(['history'], 'readonly', (tx, done) => {
    const entries: HistoryEntry[] = []
    const cursor = tx.objectStore('history').index('completedAt').openCursor(null, 'prev')
    let skipped = false
    cursor.onsuccess = () => {
      const current = cursor.result
      if (!current || entries.length >= limit) { done(entries); return }
      if (offset && !skipped) { skipped = true; current.advance(offset); return }
      entries.push(current.value as HistoryEntry)
      current.continue()
    }
  })
}

export async function historyCount(): Promise<number> {
  return transaction(['history'], 'readonly', (tx, done) => {
    const request = tx.objectStore('history').count(); request.onsuccess = () => done(request.result)
  })
}

export async function addHistoryEntry(_current: HistoryEntry[], entry: HistoryEntry): Promise<HistoryEntry[]> {
  await transaction<void>(['history'], 'readwrite', (tx) => { tx.objectStore('history').put(entry); enqueue(tx, 'history', entry.id, entry) })
  return loadHistory()
}

export async function loadCards(): Promise<SentenceProgress[]> {
  return transaction(['cards'], 'readonly', (tx, done) => {
    const request = tx.objectStore('cards').getAll(); request.onsuccess = () => done(request.result)
  })
}

export async function loadPermanentlySkippedSentenceIds(): Promise<string[]> {
  return transaction(['skips'], 'readonly', (tx, done) => {
    const request = tx.objectStore('skips').getAllKeys(); request.onsuccess = () => done(request.result as string[])
  })
}

export async function permanentlySkipSentence(_current: string[], sentenceId: string): Promise<string[]> {
  await transaction<void>(['skips'], 'readwrite', (tx) => { tx.objectStore('skips').put({ id: sentenceId }); enqueue(tx, 'skip', sentenceId, true) })
  return loadPermanentlySkippedSentenceIds()
}

export async function clearPermanentlySkippedSentences(sentenceIds?: string[]): Promise<string[]> {
  await transaction<void>(['skips'], 'readwrite', (tx) => {
    const store = tx.objectStore('skips')
    const keys = store.getAllKeys()
    keys.onsuccess = () => {
      const requested = sentenceIds ? new Set(sentenceIds) : null
      for (const id of keys.result as string[]) if (!requested || requested.has(id)) {
        store.delete(id); enqueue(tx, 'skip', id, false)
      }
    }
  })
  return loadPermanentlySkippedSentenceIds()
}

export async function recordReview(review: ReviewEntry, item: LessonItem, history: HistoryEntry,
  expectedUpdatedAt?: string): Promise<SentenceProgress | undefined> {
  const account = getAccountScope()
  return transaction(['reviews', 'cards', 'history', 'seeds'], 'readwrite', (tx, done, fail) => {
    const logs = tx.objectStore('reviews')
    const existing = logs.get(review.id)
    existing.onsuccess = () => {
      const request = tx.objectStore('cards').get(sentenceKey(review.lessonId, item.id))
      request.onsuccess = () => {
        try {
        const previous = request.result as SentenceProgress | undefined
        if (existing.result) { done(previous); return }
        if (!account && review.mode === 'memory' && previous?.updatedAt !== expectedUpdatedAt) {
          fail('这句的复习计划已在其他页面或备份中更新，请返回主页重新开始。'); return
        }
        if (!account && previous && Date.parse(previous.updatedAt) > Date.parse(review.reviewedAt)) {
          fail('设备时间早于上次复习时间，请检查系统日期。'); return
        }
        function save(next: SentenceProgress | undefined) {
          if (next) tx.objectStore('cards').put(next)
          logs.put(review); tx.objectStore('history').put(history)
          enqueue(tx, 'review', review.id, review); enqueue(tx, 'history', history.id, history)
          done(next)
        }
        if (account && review.rating !== null && previous?.updatedAt !== expectedUpdatedAt) {
          const all = logs.getAll(); const seeds = tx.objectStore('seeds').getAll()
          seeds.onsuccess = () => {
            try { save(rebuildCards([...all.result, review], seeds.result).find((card) => card.id === sentenceKey(review.lessonId, item.id))) }
            catch { fail('无法合并这次评分，请重试。') }
          }
        } else save(review.rating === null ? previous : reviewSentence(previous, review.lessonId, item, review.rating, new Date(review.reviewedAt)))
        } catch { fail('学习记录未能保存，请检查浏览器存储空间后重试。') }
      }
    }
  }, account)
}

export async function exportProgress(account = getAccountScope()): Promise<ProgressData> {
  return transaction(['history', 'skips', 'cards', 'reviews'], 'readonly', (tx, done) => {
    const data: ProgressData = { history: [], permanentlySkippedSentenceIds: [], cards: [], reviews: [] }
    const history = tx.objectStore('history').getAll(); history.onsuccess = () => { data.history = history.result }
    const skips = tx.objectStore('skips').getAllKeys(); skips.onsuccess = () => { data.permanentlySkippedSentenceIds = skips.result as string[] }
    const cards = tx.objectStore('cards').getAll(); cards.onsuccess = () => { data.cards = cards.result }
    const reviews = tx.objectStore('reviews').getAll(); reviews.onsuccess = () => { data.reviews = reviews.result }
    done(data)
  }, account)
}

export async function mergeProgress(imported: ProgressData, account = getAccountScope()): Promise<void> {
  await transaction<void>(['history', 'skips', 'cards', 'reviews', 'seeds'], 'readwrite', (tx) => {
    for (const entry of imported.history) {
      const store = tx.objectStore('history'); const request = store.get(entry.id)
      request.onsuccess = () => {
        const previous = request.result as HistoryEntry | undefined
        if (!previous || Date.parse(entry.completedAt) > Date.parse(previous.completedAt)
          || (entry.completedAt === previous.completedAt && previous.partial && !entry.partial)) { store.put(entry); enqueue(tx, 'history', entry.id, entry) }
      }
    }
    for (const id of imported.permanentlySkippedSentenceIds) { tx.objectStore('skips').put({ id }); enqueue(tx, 'skip', id, true) }
    for (const entry of imported.cards) {
      const store = tx.objectStore('cards'); const request = store.get(entry.id)
      request.onsuccess = () => {
        const previous = request.result as SentenceProgress | undefined
        if (!previous || Date.parse(entry.updatedAt) > Date.parse(previous.updatedAt)) {
          store.put(entry); tx.objectStore('seeds').put(entry); enqueue(tx, 'seed', entry.id, entry)
        }
      }
    }
    for (const entry of imported.reviews) {
      const store = tx.objectStore('reviews'); const request = store.get(entry.id)
      request.onsuccess = () => { if (!request.result) { store.put(entry); enqueue(tx, 'review', entry.id, entry) } }
    }
  }, account)
}

export async function loadStoredDecks(account = getAccountScope()): Promise<Lesson[]> {
  return transaction(['decks'], 'readonly', (tx, done) => {
    const request = tx.objectStore('decks').getAll(); request.onsuccess = () => done(request.result)
  }, account)
}

export async function storeDeck(lesson: Lesson, account = getAccountScope()) {
  if (account && new TextEncoder().encode(JSON.stringify(lesson)).length > 10 * 1024 * 1024) {
    throw new Error('卡组文本超过 10 MB 的云同步上限，请在 Anki 中拆分卡组后导入。')
  }
  await transaction<void>(['decks'], 'readwrite', (tx) => {
    tx.objectStore('decks').put(lesson); enqueue(tx, 'deck', lesson.id, lesson)
  }, account)
}

export async function loadSettings(account = getAccountScope()): Promise<Record<string, string>> {
  return transaction(['settings'], 'readonly', (tx, done) => {
    const request = tx.objectStore('settings').getAll()
    request.onsuccess = () => done(Object.fromEntries(request.result.map((row: { id: string; value: string }) => [row.id, row.value])))
  }, account)
}

export async function storeSetting(key: string, value: string, account = getAccountScope()) {
  await transaction<void>(['settings'], 'readwrite', (tx) => {
    tx.objectStore('settings').put({ id: key, value }); enqueue(tx, 'setting', key, value)
  }, account)
}

export async function pendingChanges(account: string): Promise<CloudMutation[]> {
  return transaction(['outbox'], 'readonly', (tx, done) => {
    const request = tx.objectStore('outbox').getAll(); request.onsuccess = () => done(request.result)
  }, account)
}

export async function acknowledgeChanges(account: string, sent: CloudMutation[]) {
  await transaction<void>(['outbox'], 'readwrite', (tx) => {
    for (const entry of sent) {
      const store = tx.objectStore('outbox'); const request = store.get(entry.id)
      request.onsuccess = () => { if (request.result?.mutationId === entry.mutationId) store.delete(entry.id) }
    }
  }, account, true)
}

export async function cloudCursor(account: string): Promise<number> {
  return transaction(['meta'], 'readonly', (tx, done) => {
    const request = tx.objectStore('meta').get('cloud-cursor'); request.onsuccess = () => done(request.result?.value ?? 0)
  }, account)
}

export async function applyCloudRows(account: string, rows: CloudRow[], cursor: number) {
  await transaction<void>(STORES, 'readwrite', (tx, _done, fail) => {
    const oldCursor = tx.objectStore('meta').get('cloud-cursor')
    const pendingRequest = tx.objectStore('outbox').getAll()
    const reviewRequest = tx.objectStore('reviews').getAll()
    const seedRequest = tx.objectStore('seeds').getAll()
    const historyRequest = tx.objectStore('history').getAll()
    historyRequest.onsuccess = () => {
      try {
      if ((oldCursor.result?.value ?? 0) > cursor) return // A different tab has already advanced further.
      const pending = new Set((pendingRequest.result as CloudMutation[]).map((entry) => entry.id))
      const reviews = new Map((reviewRequest.result as ReviewEntry[]).map((entry) => [entry.id, entry]))
      const seeds = new Map((seedRequest.result as SentenceProgress[]).map((entry) => [entry.id, entry]))
      const histories = new Map((historyRequest.result as HistoryEntry[]).map((entry) => [entry.id, entry]))
      for (const row of rows) {
          // A mutation made while the request was in flight still belongs to this device.
          if (pending.has(cloudKey(row.kind, row.key)) && ['setting', 'skip', 'deck'].includes(row.kind)) continue
          if (row.kind === 'skip') {
            const store = tx.objectStore('skips'); if (row.value) store.put({ id: row.key }); else store.delete(row.key)
          } else if (row.kind === 'setting') tx.objectStore('settings').put({ id: row.key, value: row.value })
          else if (row.kind === 'review') { reviews.set(row.key, row.value as ReviewEntry); tx.objectStore('reviews').put(row.value) }
          else if (row.kind === 'deck') tx.objectStore('decks').put(row.value)
          else if (row.kind === 'seed') {
            const previous = seeds.get(row.key)
            if (!previous || previous.updatedAt < (row.value as SentenceProgress).updatedAt) {
              seeds.set(row.key, row.value as SentenceProgress); tx.objectStore('seeds').put(row.value)
            }
          } else if (row.kind === 'history') {
            const previous = histories.get(row.key)
            if (!previous || previous.completedAt <= (row.value as HistoryEntry).completedAt) tx.objectStore('history').put(row.value)
          }
      }
            const cards = rebuildCards([...reviews.values()], [...seeds.values()])
            const store = tx.objectStore('cards'); store.clear()
            for (const card of cards) store.put(card)
            tx.objectStore('meta').put({ id: 'cloud-cursor', value: cursor })
      } catch { fail('云端复习记录无法合并，本地记录未改变。') }
    }
  }, account, true)
  if (account === getAccountScope()) { announce(); window.dispatchEvent(new Event(CLOUD_APPLIED)) }
}
