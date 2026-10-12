import type { Lesson } from '../types'
import { getAccountScope } from './account-scope'
import { deleteStoredDeck, loadStoredDecks } from './storage'

// Decks imported by earlier versions (in-app import has been removed). Guests
// keep them in this database; accounts keep them with their synced progress.
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

// For accounts this also uploads a tombstone, so the deck disappears on other devices after they sync.
export async function deleteImportedDeck(id: string, account = getAccountScope()): Promise<void> {
  if (account) await deleteStoredDeck(id, account)
  else {
    const db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).delete(id)
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onabort = () => { db.close(); reject(new Error('删除卡组失败，请重试。')) }
    })
  }
  try { localStorage.setItem(DECKS_UPDATED_KEY, `${Date.now()}-${Math.random()}`) } catch { /* The deck itself is deleted. */ }
}
