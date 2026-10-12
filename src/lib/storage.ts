import type { HistoryEntry, LessonItem } from '../types'
import { reviewSentence, sentenceKey, type ReviewEntry, type SentenceProgress } from './scheduler'
import { getAccountScope, scopedDatabase, notifyLocalChange } from './account-scope'
import { cloudKey, isDeckTombstone, type CloudChanges, type CloudKind, type CloudMutation, type CloudRow, type RejectedChange } from './cloud-types'
import type { Lesson } from '../types'
import { rebuildCards } from './reconcile'
import { jsonbTextBytes, SYNC_LIMITS } from './sync-size'

export const HISTORY_KEY = 'typelingo.history.ja.v2'
export const PERMANENTLY_SKIPPED_KEY = 'typelingo.skipped-sentences.ja.v1'
export const PROGRESS_UPDATED_KEY = 'typelingo.progress.updated.v3'
export const PROGRESS_DATABASE = 'typelingo.progress'
const DATABASE_VERSION = 3
// quarantine: pulled rows this version cannot read yet; rejected: changes the server will never accept.
const STORES = ['history', 'cards', 'reviews', 'skips', 'meta', 'outbox', 'settings', 'decks', 'seeds', 'quarantine', 'rejected']
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

function connect(name: string, account: string | null): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      const upgrade = request.transaction!
      for (const store of STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' })
      const history = upgrade.objectStore('history')
      if (!history.indexNames.contains('completedAt')) history.createIndex('completedAt', 'completedAt')
      const reviews = upgrade.objectStore('reviews')
      if (!reviews.indexNames.contains('sentence')) reviews.createIndex('sentence', ['lessonId', 'sentenceId'])
      // Earlier versions queued guest changes that were never uploaded.
      if (!account) upgrade.objectStore('outbox').clear()
    }
    request.onerror = () => reject(new Error('无法读取学习记录，请检查浏览器是否允许本地存储。'))
    request.onblocked = () => reject(new Error('请关闭其他日语敲敲页面后重试。'))
    request.onsuccess = () => {
      const db = request.result
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

// One connection per database, opened (and migrated) once instead of for every read and write.
const connections = new WeakMap<IDBFactory, Map<string, Promise<IDBDatabase>>>()
function databaseCache() {
  let cache = connections.get(indexedDB)
  if (!cache) { cache = new Map(); connections.set(indexedDB, cache) }
  return cache
}
function openDatabase(account: string | null): Promise<IDBDatabase> {
  const cache = databaseCache()
  const name = scopedDatabase(PROGRESS_DATABASE, account)
  const cached = cache.get(name)
  if (cached) return cached
  const forget = () => { if (cache.get(name) === opening) cache.delete(name) }
  const opening = connect(name, account).then((db) => {
    db.onversionchange = () => { db.close(); forget() }
    db.onclose = forget
    return db
  }, (error: unknown) => { forget(); throw error })
  cache.set(name, opening)
  return opening
}

export function announceProgressUpdate() {
  try { window.localStorage.setItem(PROGRESS_UPDATED_KEY, crypto.randomUUID()) } catch { /* IndexedDB is authoritative. */ }
}

async function transaction<T>(names: string[], mode: IDBTransactionMode,
  work: (tx: IDBTransaction, result: (value: T) => void, fail: (message: string) => void) => void,
  account = getAccountScope(), silent = false): Promise<T> {
  // Guests never sync, so only account writes are queued for upload.
  const stores = [...new Set([...names, ...(mode === 'readwrite' && account ? ['outbox'] : [])])]
  let tx: IDBTransaction
  try { tx = (await openDatabase(account)).transaction(stores, mode) }
  catch (error) {
    // The connection was closed under us (another tab upgraded it, or site data was cleared).
    if (!(error instanceof DOMException && error.name === 'InvalidStateError')) throw error
    databaseCache().delete(scopedDatabase(PROGRESS_DATABASE, account))
    tx = (await openDatabase(account)).transaction(stores, mode)
  }
  return new Promise((resolve, reject) => {
    let value: T
    let message = '学习记录未能保存，请检查浏览器存储空间后重试。'
    tx.oncomplete = () => { if (mode === 'readwrite' && !silent) { announceProgressUpdate(); if (account === getAccountScope()) notifyLocalChange() }; resolve(value) }
    tx.onabort = () => reject(new Error(message))
    try { work(tx, (next) => { value = next }, (reason) => { message = reason; tx.abort() }) }
    catch { tx.abort() }
  })
}

function enqueue(tx: IDBTransaction, kind: CloudKind, key: string, value: unknown) {
  if (!tx.objectStoreNames.contains('outbox')) return
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

export async function loadActivityRecords(): Promise<{ reviews: ReviewEntry[]; history: HistoryEntry[] }> {
  return transaction(['reviews', 'history'], 'readonly', (tx, done) => {
    const reviews = tx.objectStore('reviews').getAll()
    const history = tx.objectStore('history').getAll()
    history.onsuccess = () => done({ reviews: reviews.result, history: history.result })
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
  const key = sentenceKey(review.lessonId, item.id)
  return transaction(['reviews', 'cards', 'history', 'seeds'], 'readwrite', (tx, done, fail) => {
    const logs = tx.objectStore('reviews')
    const existing = logs.get(review.id)
    existing.onsuccess = () => {
      const request = tx.objectStore('cards').get(key)
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
          // Another device or tab changed this sentence: replay its complete log.
          const all = logs.index('sentence').getAll([review.lessonId, item.id]); const seed = tx.objectStore('seeds').get(key)
          seed.onsuccess = () => {
            try { save(rebuildCards([...all.result, review], seed.result ? [seed.result] : []).find((card) => card.id === key)) }
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

export const deckFitsCloud = (lesson: Lesson) => jsonbTextBytes(JSON.stringify(lesson)) <= SYNC_LIMITS.deckBytes

export async function storeDeck(lesson: Lesson, account = getAccountScope()) {
  if (account && !deckFitsCloud(lesson)) throw new Error('卡组超过 10 MB 的云同步上限，未保存到账号。')
  await transaction<void>(['decks'], 'readwrite', (tx) => {
    tx.objectStore('decks').put(lesson); enqueue(tx, 'deck', lesson.id, lesson)
  }, account)
}

export async function deleteStoredDeck(id: string, account = getAccountScope()) {
  await transaction<void>(['decks'], 'readwrite', (tx) => {
    tx.objectStore('decks').delete(id); enqueue(tx, 'deck', id, { id, deleted: true })
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

export async function pendingChanges(account: string | null): Promise<CloudMutation[]> {
  return transaction(['outbox'], 'readonly', (tx, done) => {
    const request = tx.objectStore('outbox').getAll(); request.onsuccess = () => done(request.result)
  }, account)
}

// Removes accepted changes from the queue and moves rejected ones aside, unless the
// record was edited again during the upload (it then has a new mutation ID).
export async function acknowledgeChanges(account: string, sent: CloudMutation[], rejected: RejectedChange[] = []) {
  await transaction<void>(['outbox', 'rejected'], 'readwrite', (tx) => {
    const outbox = tx.objectStore('outbox')
    for (const entry of sent) {
      const request = outbox.get(entry.id)
      request.onsuccess = () => { if (request.result?.mutationId === entry.mutationId) outbox.delete(entry.id) }
    }
    for (const { change, error } of rejected) {
      const request = outbox.get(change.id)
      request.onsuccess = () => {
        if (request.result?.mutationId !== change.mutationId) return
        outbox.delete(change.id)
        tx.objectStore('rejected').put({ ...change, error, rejectedAt: new Date().toISOString() })
      }
    }
  }, account, true)
}

export async function cloudCursor(account: string): Promise<number> {
  return transaction(['meta'], 'readonly', (tx, done) => {
    const request = tx.objectStore('meta').get('cloud-cursor'); request.onsuccess = () => done(request.result?.value ?? 0)
  }, account)
}

export async function loadQuarantine(account: string): Promise<CloudRow[]> {
  return transaction(['quarantine'], 'readonly', (tx, done) => {
    const request = tx.objectStore('quarantine').getAll(); request.onsuccess = () => done(request.result)
  }, account)
}

// Rebuilds only the schedules of sentences whose logs or checkpoints changed.
function rebuildTouched(tx: IDBTransaction, touched: Map<string, [string, string]>, fail: (message: string) => void) {
  if (!touched.size) return
  const lookups = [...touched].map(([key, sentence]) => ({ key,
    logs: tx.objectStore('reviews').index('sentence').getAll(sentence), seed: tx.objectStore('seeds').get(key) }))
  // Requests complete in order, so every lookup has finished when this one does.
  const ready = tx.objectStore('meta').count()
  ready.onsuccess = () => {
    try {
      for (const { key, logs, seed } of lookups) {
        const card = rebuildCards(logs.result, seed.result ? [seed.result] : []).find((entry) => entry.id === key)
        if (card) tx.objectStore('cards').put(card)
      }
    } catch { fail('云端复习记录无法合并，本地记录未改变。') }
  }
}

// Applies one pulled page (or, with a null cursor, quarantined rows that are now readable).
// Rows this version cannot read are kept aside instead of blocking the rest of the page.
export async function applyCloudRows(account: string, rows: CloudRow[], cursor: number | null,
  readable: (row: CloudRow) => boolean = () => true): Promise<CloudChanges> {
  const changed: CloudChanges = { progress: false, settings: false, decks: false }
  await transaction<void>(STORES, 'readwrite', (tx, _done, fail) => {
    const store = (name: string) => tx.objectStore(name)
    const oldCursor = store('meta').get('cloud-cursor')
    const lookups = rows.map((row) => ({ row,
      pending: store('outbox').count(cloudKey(row.kind, row.key)),
      previous: row.kind === 'history' ? store('history').get(row.key) : row.kind === 'seed' ? store('seeds').get(row.key) : undefined }))
    const ready = store('meta').count()
    ready.onsuccess = () => {
      try {
        if (cursor !== null && (oldCursor.result?.value ?? 0) > cursor) return // A different tab has already advanced further.
        const touched = new Map<string, [string, string]>()
        for (const { row, pending, previous } of lookups) {
          const id = cloudKey(row.kind, row.key)
          store('quarantine').delete(id)
          if (!readable(row)) { store('quarantine').put({ ...row, id }); continue }
          // A mutation made while the request was in flight still belongs to this device.
          if (pending.result > 0 && ['setting', 'skip', 'deck'].includes(row.kind)) continue
          if (row.kind === 'skip') {
            if (row.value) store('skips').put({ id: row.key }); else store('skips').delete(row.key)
            changed.progress = true
          } else if (row.kind === 'setting') {
            store('settings').put({ id: row.key, value: row.value }); changed.settings = true
          } else if (row.kind === 'deck') {
            if (isDeckTombstone(row.value)) store('decks').delete(row.key); else store('decks').put(row.value)
            changed.decks = true
          } else if (row.kind === 'review') {
            const review = row.value as ReviewEntry
            store('reviews').put(review); changed.progress = true
            if (review.rating !== null) touched.set(sentenceKey(review.lessonId, review.sentenceId), [review.lessonId, review.sentenceId])
          } else if (row.kind === 'seed') {
            const seed = row.value as SentenceProgress, old = previous?.result as SentenceProgress | undefined
            if (!old || old.updatedAt < seed.updatedAt) {
              store('seeds').put(seed); touched.set(seed.id, [seed.lessonId, seed.sentenceId]); changed.progress = true
            }
          } else if (row.kind === 'history') {
            const entry = row.value as HistoryEntry, old = previous?.result as HistoryEntry | undefined
            if (!old || old.completedAt <= entry.completedAt) { store('history').put(entry); changed.progress = true }
          }
        }
        if (cursor !== null) store('meta').put({ id: 'cloud-cursor', value: cursor })
        rebuildTouched(tx, touched, fail)
      } catch { fail('云端复习记录无法合并，本地记录未改变。') }
    }
  }, account, true)
  return changed
}
