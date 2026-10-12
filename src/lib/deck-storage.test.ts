import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { loadImportedDecks } from './deck-storage'
import type { Lesson } from '../types'

const deck: Lesson = {
  schemaVersion: 2, id: 'anki-test', title: '测试导入', nativeLanguage: 'zh-CN', targetLanguage: 'ja',
  items: [{ id: 'anki-test:1', text: '猫です', nativeText: '是猫', ruby: [{ text: '猫', reading: 'ねこ' }, { text: 'です' }] }],
}
// Earlier versions saved guest imports here.
async function seedLegacyDeck(lesson: Lesson) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('typelingo.decks.v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('decks', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
  })
  await new Promise((resolve, reject) => {
    const tx = db.transaction('decks', 'readwrite'); tx.objectStore('decks').put(lesson)
    tx.oncomplete = resolve; tx.onabort = reject
  })
  db.close()
}
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('localStorage', { setItem: vi.fn() }) })
afterEach(() => { vi.unstubAllGlobals() })

describe('previously imported decks', () => {
  it('keeps decks imported by earlier versions available with their readings', async () => {
    expect(await loadImportedDecks()).toEqual([])
    await seedLegacyDeck(deck)
    const saved = await loadImportedDecks()
    expect(saved).toEqual([deck])
    expect(saved[0]?.items[0]?.ruby).toEqual(deck.items[0]?.ruby)
  })
})
