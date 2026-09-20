// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ReviewDock } from './ReviewDock'

it('keeps the mobile rating controls inside the visible area as the keyboard opens and pans', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  const viewport = Object.assign(new EventTarget(), { height: 800, width: 390, offsetTop: 0, offsetLeft: 0 })
  vi.stubGlobal('visualViewport', viewport)
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    act(() => root.render(createElement(ReviewDock, null, createElement('button', null, '良好'))))
    const dock = document.querySelector<HTMLElement>('.review-dock')!
    expect(dock.parentElement).toBe(document.body)
    expect(dock.style.height).toBe('800px')
    viewport.height = 340; viewport.offsetTop = 120
    act(() => viewport.dispatchEvent(new Event('resize')))
    expect(dock.style.height).toBe('340px'); expect(dock.style.top).toBe('120px')
    viewport.offsetTop = 160
    act(() => viewport.dispatchEvent(new Event('scroll')))
    expect(dock.style.top).toBe('160px')
    expect(dock.querySelector('button')?.textContent).toBe('良好')
    act(() => root.unmount())
    expect(document.querySelector('.review-dock')).toBeNull()
  } finally { container.remove(); vi.unstubAllGlobals() }
})
