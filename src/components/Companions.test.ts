// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PracticeCompanions } from './Companions'
import { DEFAULT_COMPANION, type CompanionPreferences } from '../lib/companions'

let container: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function render(preferences: CompanionPreferences = DEFAULT_COMPANION, typed = '') {
  act(() => root.render(createElement(PracticeCompanions, { preferences, points: { golden: 4, tuxedo: 2 }, typed, complete: false })))
}
function click(label: string) {
  act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === label)!.click())
}

it('keeps the dog left and cat right while the unselected animal reads its own books', () => {
  render()
  expect([...container.querySelectorAll('aside')].map((node) => node.className)).toEqual(['pet-side pet-side--golden', 'pet-side pet-side--tuxedo'])
  expect(container.querySelector('.pet-side--golden')?.getAttribute('data-active')).toBe('true')
  expect(container.querySelector('.pet-side--tuxedo')?.textContent).toContain('高效猫猫的七个习惯')
  render({ ...DEFAULT_COMPANION, petId: 'tuxedo' })
  expect(container.querySelector('.pet-side--golden')?.textContent).toContain('如何赢得狗狗朋友')
  expect(container.querySelector('.pet-side--tuxedo')?.getAttribute('data-active')).toBe('true')
})

it('turns real pages and changes books without restarting when the learner types', () => {
  render(); click('翻一页')
  expect(container.textContent).toContain('第 2 / 4 页')
  expect(container.textContent).toContain('重要的事先做')
  render(DEFAULT_COMPANION, '猫')
  expect(container.textContent).toContain('第 2 / 4 页')
  click('换本书')
  expect(container.textContent).toContain('原子喵习惯'); expect(container.textContent).toContain('第 1 / 4 页')
  act(() => vi.advanceTimersByTime(6000))
  expect(container.textContent).toContain('第 2 / 4 页')
  // Pointer interaction should preserve focus in the typing field.
  const event = new Event('pointerdown', { bubbles: true, cancelable: true })
  container.querySelector('button')!.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
})

it('switches to exercise with counted repetitions, then back to reading, and clears timers when hidden', () => {
  render(); act(() => vi.advanceTimersByTime(36000))
  expect(container.querySelector('.pet-free-time')?.getAttribute('data-activity')).toBe('workout')
  act(() => vi.advanceTimersByTime(4800))
  expect(container.textContent).toContain('已举 2 次')
  click('去读书'); expect(container.textContent).toContain('翻一页')
  click('去锻炼'); expect(container.textContent).toContain('爪爪健身房')
  render({ ...DEFAULT_COMPANION, enabled: false })
  expect(container.children).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['setting', 'reduced-motion'])('pauses autonomous activity for %s while manual reading still works', (reason) => {
  if (reason === 'reduced-motion') vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  render({ ...DEFAULT_COMPANION, animations: reason !== 'setting' })
  expect(container.querySelector('.pet-free-time')?.getAttribute('data-animate')).toBe('false')
  act(() => vi.advanceTimersByTime(72000))
  expect(container.textContent).toContain('第 1 / 4 页')
  click('翻一页'); expect(container.textContent).toContain('第 2 / 4 页')
  click('去锻炼'); act(() => vi.advanceTimersByTime(10000))
  expect(container.textContent).toContain('已举 0 次')
})
