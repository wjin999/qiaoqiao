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

it('turns reading excerpts and changes books without restarting when the learner types', () => {
  render(); click('翻一页')
  expect(container.textContent).toContain('第 2 / 4 页')
  expect(container.textContent).toContain('重要的事先做')
  render(DEFAULT_COMPANION, '猫')
  expect(container.textContent).toContain('第 2 / 4 页')
  click('换本书')
  expect(container.textContent).toContain('原子喵习惯'); expect(container.textContent).toContain('第 1 / 4 页')
  expect((container.querySelector('.pet-activity-frame') as HTMLElement).style.getPropertyValue('--book')).toBe('1')
  act(() => vi.advanceTimersByTime(6000))
  expect(container.textContent).toContain('第 2 / 4 页')
  // Pointer interaction should preserve focus in the typing field.
  const event = new Event('pointerdown', { bubbles: true, cancelable: true })
  container.querySelector('button')!.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  click('换本书'); click('换本书'); click('换本书')
  expect(container.textContent).toContain('高效猫猫的七个习惯')
  expect((container.querySelector('.pet-activity-frame') as HTMLElement).style.getPropertyValue('--book')).toBe('0')
})

it('keeps reading and pauses the page timer in background, clearing it when companions are hidden', () => {
  render(); act(() => vi.advanceTimersByTime(36000))
  expect(container.textContent).toContain('第 3 / 4 页')
  expect(container.textContent).not.toMatch(/锻炼|健身|已举/)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  act(() => vi.advanceTimersByTime(6000))
  expect(container.textContent).toContain('第 3 / 4 页')
  render({ ...DEFAULT_COMPANION, enabled: false })
  expect(container.children).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
})

it('plays the approved sheet on a page turn, preserves it while typing, and stops it for another book', () => {
  render()
  const picture = () => container.querySelector('.pet-turn-frame') as HTMLElement
  const img = picture().querySelector('img')!
  expect(img.getAttribute('src')).toContain('tuxedo-turn.png')
  click('翻一页')
  expect(picture().dataset.turning).toBe('false')
  act(() => picture().querySelector('img')!.dispatchEvent(new Event('load')))
  expect(picture().dataset.turning).toBe('true')
  const frame = picture()
  render(DEFAULT_COMPANION, '猫')
  expect(picture()).toBe(frame)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(picture().style.animationPlayState).toBe('paused')
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(picture().style.animationPlayState).toBe('running')
  click('换本书')
  expect(container.querySelector('.pet-turn-frame')).toBeNull()
  expect(container.textContent).toContain('原子喵习惯')
  click('换本书'); click('换本书'); click('换本书')
  expect(picture().dataset.turning).toBe('false')
  act(() => vi.advanceTimersByTime(6000))
  expect(picture().dataset.turning).toBe('true')
})

it.each(['setting', 'reduced-motion'])('pauses autonomous activity for %s while manual reading still works', (reason) => {
  if (reason === 'reduced-motion') vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  render({ ...DEFAULT_COMPANION, animations: reason !== 'setting' })
  expect(container.querySelector('.pet-free-time')?.getAttribute('data-animate')).toBe('false')
  act(() => vi.advanceTimersByTime(72000))
  expect(container.textContent).toContain('第 1 / 4 页')
  click('翻一页'); expect(container.textContent).toContain('第 2 / 4 页')
  act(() => container.querySelector('.pet-turn-frame img')!.dispatchEvent(new Event('load')))
  expect((container.querySelector('.pet-turn-frame') as HTMLElement).dataset.turning).toBe('false')
  act(() => vi.advanceTimersByTime(10000))
  expect(container.textContent).toContain('第 2 / 4 页')
})
