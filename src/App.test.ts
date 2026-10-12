// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import App from './App'
import { addHistoryEntry, exportProgress, PROGRESS_UPDATED_KEY } from './lib/storage'
import { loadImportedDecks } from './lib/deck-storage'
import type { Lesson } from './types'

const deck = vi.hoisted(() => ({ ready: Promise.resolve() as Promise<void> }))
vi.mock('./lib/default-deck', () => ({ DEFAULT_DECK_ID: 'test-deck', loadDefaultDeck: async () => { await deck.ready; return {
  schemaVersion: 2, id: 'test-deck', title: '测试卡组', nativeLanguage: 'zh-CN', targetLanguage: 'ja',
  items: Array.from({ length: 12 }, (_, index) => ({ id: `sentence-${index}`, sourceNoteId: `note-${index}`,
    text: index === 0 ? '猫1234。' : `猫${index}。`, nativeText: '猫', level: 'N5',
    ruby: [{ text: '猫', reading: 'ねこ' }, { text: index === 0 ? '1234。' : `${index}。` }] })),
} } }))

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

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((element) => element.textContent?.includes(label))
  if (!found) throw new Error(`Button not found: ${label}`)
  return found
}
async function until(check: () => boolean) {
  for (let index = 0; index < 100; index++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
    if (check()) return
  }
  throw new Error('UI did not settle')
}
async function mount() {
  await act(async () => root.render(createElement(StrictMode, null, createElement(App))))
  await until(() => [...container.querySelectorAll('button')].some((element) => element.textContent?.includes('开始练习') && !element.disabled))
}
async function start() {
  act(() => button('开始练习').click())
  await until(() => !!container.querySelector('#typing-input'))
}
const input = () => container.querySelector<HTMLInputElement>('#typing-input')!
// Decks imported by earlier versions stay in this guest database.
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
function type(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function key(key: string, options: KeyboardEventInit = {}) {
  act(() => input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })))
}

describe('keyboard memory reviews', () => {
  it('saves a sentence only after it is completed and rated', async () => {
    await mount()
    expect(container.textContent).not.toContain('成长')
    await start(); type('猫1234。')
    expect((await exportProgress()).reviews).toHaveLength(0)
    key('1')
    await until(() => container.querySelector('.progress-count')?.textContent === '2 / 10')
    const [saved] = (await exportProgress()).reviews
    expect(saved).toMatchObject({ mode: 'memory', rating: 1, sentenceId: 'sentence-0' })
    expect(saved).not.toHaveProperty('petId')
  })
  it('restores the selected imported deck and each deck’s own level after reopening', async () => {
    await seedLegacyDeck({ schemaVersion: 2, id: 'imported', title: '导入卡组', nativeLanguage: 'zh-CN', targetLanguage: 'ja',
      items: [{ id: 'imported:1', text: '猫', nativeText: '猫', level: 'N3', ruby: [{ text: '猫' }] }] })
    await mount()
    function select(id: string, value: string) {
      act(() => {
        const element = container.querySelector<HTMLSelectElement>(`#${id}`)!
        element.value = value; element.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }
    select('level-select', 'N5')
    select('deck-select', 'imported')
    expect(container.querySelector<HTMLSelectElement>('#level-select')?.value).toBe('all')
    select('level-select', 'N3')
    select('deck-select', 'test-deck')
    expect(container.querySelector<HTMLSelectElement>('#level-select')?.value).toBe('N5')
    select('deck-select', 'imported')
    act(() => root.unmount())
    root = createRoot(container)
    await mount()
    expect(container.querySelector<HTMLSelectElement>('#deck-select')?.value).toBe('imported')
    expect(container.querySelector<HTMLSelectElement>('#level-select')?.value).toBe('N3')
    await start()
    expect(container.querySelector('.sentence')?.getAttribute('aria-label')).toBe('猫')
  })

  it('deletes a previously imported deck and falls back to the default deck', async () => {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
    HTMLDialogElement.prototype.close = function () { this.open = false }
    await seedLegacyDeck({ schemaVersion: 2, id: 'imported', title: '导入卡组', nativeLanguage: 'zh-CN', targetLanguage: 'ja',
      items: [{ id: 'imported:1', text: '猫', nativeText: '猫', ruby: [{ text: '猫' }] }] })
    await mount()
    act(() => {
      const element = container.querySelector<HTMLSelectElement>('#deck-select')!
      element.value = 'imported'; element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    act(() => button('卡组详情').click())
    act(() => button('删除此卡组').click())
    act(() => button('确认删除').click())
    await until(() => ![...container.querySelectorAll('#deck-select option')].some((option) => (option as HTMLOptionElement).value === 'imported'))
    expect(container.querySelector<HTMLSelectElement>('#deck-select')?.value).toBe('test-deck')
    expect(await loadImportedDecks()).toEqual([])
    act(() => button('卡组详情').click())
    expect(container.textContent).not.toContain('删除此卡组')
  })

  it('shows the home screen while the default deck is still loading', async () => {
    let release!: () => void
    deck.ready = new Promise<void>((resolve) => { release = resolve })
    try {
      await act(async () => root.render(createElement(StrictMode, null, createElement(App))))
      await until(() => container.textContent?.includes('共 0 轮') ?? false)
      expect(button('正在加载例句库').disabled).toBe(true)
      expect(container.textContent).toContain('正在加载 egg rolls 例句库')
      await act(async () => release())
      await until(() => [...container.querySelectorAll('button')].some((element) => element.textContent?.includes('开始练习') && !element.disabled))
    } finally { deck.ready = Promise.resolve() }
  })

  it('keeps characters outside the BMP whole while typing', async () => {
    await seedLegacyDeck({ schemaVersion: 2, id: 'rare', title: '生僻字', nativeLanguage: 'zh-CN', targetLanguage: 'ja',
      items: [{ id: 'rare:1', text: '𠮟る', nativeText: '责备', ruby: [{ text: '𠮟', reading: 'しか' }, { text: 'る' }] }] })
    await mount()
    act(() => {
      const element = container.querySelector<HTMLSelectElement>('#deck-select')!
      element.value = 'rare'; element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await start(); type('𠮟')
    const characters = [...container.querySelectorAll('.sentence .character')]
    expect(characters.map((node) => node.textContent)).toEqual(['𠮟', 'る'])
    expect(characters.map((node) => node.className)).toEqual(['character character--correct', 'character character--pending'])
  })

  it('offers no in-app import and points to the author instead', async () => {
    await mount()
    expect(container.textContent).not.toContain('添加 Anki 卡组')
    expect(container.querySelector('.deck-note')?.textContent).toBe('如果想使用自己的 Anki 卡组，请联系作者。')
  })

  it('toggles furigana with Tab before and after completion without stealing IME or Shift+Tab', async () => {
    await mount(); await start()
    key('Tab', { isComposing: true, keyCode: 229 })
    key('Tab', { shiftKey: true })
    expect(container.querySelector('rt')).toBeNull()
    key('Tab')
    expect(container.querySelector('rt')).not.toBeNull()
    expect(document.activeElement).toBe(input())
    key('Tab', { repeat: true })
    expect(container.querySelector('rt')).not.toBeNull()
    key('Tab')
    expect(container.querySelector('rt')).toBeNull()
    type('猫1234。')
    expect(input().readOnly).toBe(true)
    key('Tab')
    expect(container.querySelector('rt')).toBeNull()
    key('Tab')
    expect(container.querySelector('rt')).not.toBeNull()
    key('3')
    await until(() => container.querySelector('.progress-count')?.textContent === '2 / 10')
    expect((await exportProgress()).reviews[0]?.hintUsed).toBe(true)
  })

  it.each([1, 2, 3, 4])('locks the completed input and records grade %s exactly once', async (grade) => {
    await mount(); await start()
    expect(container.querySelector('rt')).toBeNull()
    key(String(grade))
    expect(container.querySelector('.rating-options')).toBeNull()
    type('猫1234。')
    expect(input().readOnly).toBe(true)
    expect(container.querySelectorAll('.rating-button')).toHaveLength(4)
    expect([...container.querySelectorAll('kbd')].map((element) => element.textContent)).toEqual(['1', '2', '3', '4'])
    expect(container.querySelector('rt')?.textContent).toBe('ねこ')
    key('Enter')
    expect(container.querySelector('.progress-count')?.textContent).toBe('1 / 10')
    key(String(grade), { repeat: true })
    key(String(grade), { ctrlKey: true })
    expect((await exportProgress()).reviews).toHaveLength(0)
    key(String(grade)); key(String(grade))
    await until(() => container.querySelector('.progress-count')?.textContent === '2 / 10')
    expect(input().readOnly).toBe(false)
    expect(input().value).toBe('')
    expect(document.activeElement).toBe(input())
    const data = await exportProgress()
    expect(data.reviews).toHaveLength(1)
    expect(data.reviews[0]?.rating).toBe(grade)
    expect(data.cards[0]?.card.reps).toBe(1)
    expect(data.history[0]?.partial).toBe(true)
    expect(data.history[0]?.sentenceCount).toBe(1)
  })

  it('does not lock or rate during IME conversion, including numeric candidate keys', async () => {
    await mount(); await start()
    act(() => input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    type('猫1234。')
    key('3', { isComposing: true, keyCode: 229 })
    expect(input().readOnly).toBe(false)
    expect(container.querySelector('.rating-panel')).toBeNull()
    act(() => input().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '猫1234。' })))
    expect(input().readOnly).toBe(true)
    key('1', { isComposing: true, keyCode: 229 })
    expect((await exportProgress()).reviews).toHaveLength(0)
    key('4')
    await until(() => container.querySelector('.progress-count')?.textContent === '2 / 10')
    expect((await exportProgress()).reviews[0]?.rating).toBe(4)
  })

  it('keeps free typing on Enter with furigana enabled, and leaves memory plans unchanged', async () => {
    await mount()
    act(() => button('自由跟打').click())
    await start()
    expect(container.querySelector('rt')).not.toBeNull()
    type(container.querySelector('.sentence')!.getAttribute('aria-label')!)
    key('3')
    expect(container.querySelector('.rating-options')).toBeNull()
    key('Enter')
    await until(() => container.querySelector('.progress-count')?.textContent === '2 / 10')
    const data = await exportProgress()
    expect(data.cards).toEqual([])
    expect(data.reviews[0]?.rating).toBeNull()
  })

  it('finishes a full round once and stops introducing new cards after the daily limit', async () => {
    const persist = vi.fn(async () => true)
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: async () => false, persist } })
    await mount(); await start()
    for (let index = 0; index < 10; index++) {
      type(container.querySelector('.sentence')!.getAttribute('aria-label')!)
      key('4')
      await until(() => index === 9 ? !!container.querySelector('.result-screen')
        : container.querySelector('.progress-count')?.textContent === `${index + 2} / 10`)
    }
    await until(() => button('再来一组').disabled)
    const data = await exportProgress()
    expect(data.reviews).toHaveLength(10)
    expect(data.history).toHaveLength(1)
    expect(data.history[0]?.sentenceCount).toBe(10)
    expect(data.history[0]?.partial).toBe(false)
    act(() => button('回到主页').click())
    expect(container.textContent).toContain('今日已学新句 10 句')
    expect(button('暂时没有待练句子').disabled).toBe(true)
    // Once a round is finished, ask the browser to keep the records.
    expect(persist).toHaveBeenCalledTimes(1)
    delete (navigator as { storage?: unknown }).storage
  })

  it('updates and pages long-term history after another tab saves', async () => {
    await mount()
    await Promise.all(Array.from({ length: 7 }, (_, index) => addHistoryEntry([], {
      id: `other-${index}`, lessonId: 'deck', completedAt: new Date(2026, 8, 13, 12, index).toISOString(),
      sentenceCount: index, elapsedMs: 1000,
    })))
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: PROGRESS_UPDATED_KEY, storageArea: window.localStorage })))
    await until(() => container.querySelectorAll('.history-row').length === 5)
    expect(container.textContent).toContain('共 7 轮')
    act(() => button('下一页').click())
    await until(() => container.querySelectorAll('.history-row').length === 2)
  })
})
