// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TargetSentence } from './TargetSentence'
import type { LessonItem } from '../types'

let container: HTMLDivElement
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('p'); document.body.append(container) })
afterEach(() => { container.remove(); vi.unstubAllGlobals() })
function render(item: LessonItem, typed: string, showReadings: boolean) {
  const root = createRoot(container)
  act(() => root.render(createElement(TargetSentence, { item, typed, showReadings })))
  const characters = [...container.querySelectorAll('.character')]
  const result = { text: characters.map((node) => node.textContent), state: characters.map((node) => node.className.replace('character character--', '')),
    readings: [...container.querySelectorAll('rt')].map((node) => node.textContent) }
  act(() => root.unmount())
  return result
}

it('keeps characters outside the BMP whole while typing', () => {
  const item: LessonItem = { id: 'rare', text: '𠮟る', nativeText: '责备', ruby: [{ text: '𠮟', reading: 'しか' }, { text: 'る' }] }
  expect(render(item, '𠮟', false)).toEqual({ text: ['𠮟', 'る'], state: ['correct', 'pending'], readings: [] })
  expect(render(item, '叱', true)).toMatchObject({ state: ['incorrect', 'pending'], readings: ['しか'] })
})
