import type { Lesson } from '../types'
import { getAccountScope } from './account-scope'
import { loadStoredDecks, storeDeck } from './storage'

const DATABASE = 'typelingo.decks.v1'
const STORE = 'decks'
export const DECKS_UPDATED_KEY = 'typelingo.decks.updated.v1'

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('无法访问卡组存储，请检查浏览器设置。'))
  })
}

export async function loadImportedDecks(account = getAccountScope()): Promise<Lesson[]> {
  if (account) return loadStoredDecks(account)
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly')
    const request = transaction.objectStore(STORE).getAll()
    transaction.oncomplete = () => { db.close(); resolve(request.result as Lesson[]) }
    transaction.onabort = () => { db.close(); reject(new Error('读取已导入卡组失败。')) }
  })
}

export async function saveImportedDeck(lesson: Lesson): Promise<void> {
  if (getAccountScope()) { await storeDeck(lesson); return }
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(lesson)
    transaction.oncomplete = () => {
      db.close()
      try { localStorage.setItem(DECKS_UPDATED_KEY, `${Date.now()}-${Math.random()}`) } catch { /* The deck itself has been saved. */ }
      resolve()
    }
    transaction.onabort = () => {
      db.close()
      reject(new Error('卡组保存失败，浏览器存储空间可能不足。请释放空间后重试。'))
    }
  })
}
