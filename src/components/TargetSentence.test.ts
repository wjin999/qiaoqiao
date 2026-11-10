// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TargetSentence } from './TargetSentence'
import type { LessonItem } from '../types'

let container: HTMLDivElement
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('p'); document.body.append(container) })
afterEach(() => { container.remove(); vi.unstubAllGlobals() })
function render(item: LessonItem, typed: string, showReadings: boolean, composingFrom: number | null = null) {
  const root = createRoot(container)
  act(() => root.render(createElement(TargetSentence, { item, typed, showReadings, composingFrom })))
  const characters = [...container.querySelectorAll('.character')]
  // The characters with a "|" wherever the line may break.
  const breaks = [...container.querySelectorAll('.character, wbr')].map((node) => node.tagName === 'WBR' ? '|' : node.textContent).join('')
  const result = { text: characters.map((node) => node.textContent), state: characters.map((node) => node.className.replace('character character--', '')),
    readings: [...container.querySelectorAll('rt')].map((node) => node.textContent), breaks }
  act(() => root.unmount())
  return result
}

it('keeps characters outside the BMP whole while typing', () => {
  const item: LessonItem = { id: 'rare', text: '𠮟る', nativeText: '责备', ruby: [{ text: '𠮟', reading: 'しか' }, { text: 'る' }] }
  expect(render(item, '𠮟', false)).toEqual({ text: ['𠮟', 'る'], state: ['correct', 'pending'], readings: [], breaks: '𠮟る' })
  expect(render(item, '叱', true)).toMatchObject({ state: ['incorrect', 'pending'], readings: ['しか'] })
})

it('shows text the IME has not confirmed as in progress, not as wrong', () => {
  const item: LessonItem = { id: 'era', text: '20世紀末', nativeText: '20世纪末', ruby: [{ text: '20' }, { text: '世紀末', reading: 'せいきまつ' }] }
  expect(render(item, '20せ', true, 2).state).toEqual(['correct', 'correct', 'composing', 'pending', 'pending'])
  expect(render(item, '20せ', true).state).toEqual(['correct', 'correct', 'incorrect', 'pending', 'pending'])
  expect(render(item, '20世紀', true).state).toEqual(['correct', 'correct', 'correct', 'correct', 'pending'])
})

it('lets a line break only between phrases, never inside a reading group', () => {
  const item: LessonItem = { id: 'fan', text: '黒い油でべっとりした換気扇は汚くて掃除しにくい', nativeText: '沾满黑色油污的抽油烟机，又脏又难清理',
    ruby: [{ text: '黒', reading: 'くろ' }, { text: 'い' }, { text: '油', reading: 'あぶら' }, { text: 'でべっとりした' }, { text: '換気扇', reading: 'かんきせん' },
      { text: 'は' }, { text: '汚', reading: 'きたな' }, { text: 'くて' }, { text: '掃除', reading: 'そうじ' }, { text: 'しにくい' }] }
  expect(render(item, '', true).breaks).toBe('黒い油で|べっとりした|換気扇は|汚くて|掃除しにくい')
})
