// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import App from './App'
import { LANGUAGE_KEY } from './lib/preferences'

vi.mock('./lib/decks', () => ({ DECK_IDS: { ja: 'test-deck', en: 'test-english' }, loadDeck: async (language: 'ja' | 'en') => ({
  schemaVersion: 2, id: language === 'ja' ? 'test-deck' : 'test-english', title: language === 'ja' ? '测试卡组' : '英文测试',
  nativeLanguage: 'zh-CN', targetLanguage: language,
  items: [{ id: `${language}-1`, text: language === 'ja' ? '猫。' : 'Cat.', nativeText: '猫', ruby: [{ text: language === 'ja' ? '猫。' : 'Cat.' }] }],
}) }))

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('indexedDB', new IDBFactory())
  window.localStorage.clear()
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

it('offers Japanese only, even to someone who picked English before', async () => {
  window.localStorage.setItem(LANGUAGE_KEY, 'en')
  await act(async () => root.render(createElement(StrictMode, null, createElement(App))))
  for (let index = 0; index < 100 && container.querySelector('.deck-title')?.textContent !== '测试卡组'; index++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
  }
  expect(container.querySelector('.deck-title')?.textContent).toBe('测试卡组')
  expect(container.querySelector('h1')?.textContent).toBe('打字，记住日语。')
  expect(container.querySelector('.language-switch')).toBeNull()
  expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes('英语'))).toBe(false)
})
