// @vitest-environment jsdom
// Reads that answer after the app has closed must be dropped: applying them touches a page that is gone
// (in a finished test file, a window that no longer exists).
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import App from './App'

vi.mock('./lib/decks', () => ({ DECK_IDS: { ja: 'test-deck', en: 'test-english' }, loadDeck: async () => ({
  schemaVersion: 2, id: 'test-deck', title: '测试卡组', nativeLanguage: 'zh-CN', targetLanguage: 'ja',
  items: [{ id: 'ja-1', text: '猫。', nativeText: '猫', ruby: [{ text: '猫。' }] }] }) }))
vi.mock('./lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/storage')>()
  const late = () => new Promise<never>((_, reject) => setTimeout(() => reject(new Error("database closed")), 60))
  return { ...actual, loadHistory: late, historyCount: late, loadPermanentlySkippedSentenceIds: late, loadCards: late }
})

it('drops learning-record reads that finish after the app closes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('indexedDB', new IDBFactory())
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(createElement(App)))
  act(() => root.unmount())
  container.remove()
  // What the test environment looks like once torn down: no window. The late reads answer now.
  vi.stubGlobal('window', undefined)
  const errors: unknown[] = []
  const onRejection = (error: unknown) => { errors.push(error) }
  process.on('unhandledRejection', onRejection)
  await new Promise((resolve) => setTimeout(resolve, 150))
  process.off('unhandledRejection', onRejection)
  vi.unstubAllGlobals()
  expect(errors.map(String)).toEqual([])
})
