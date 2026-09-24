// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { Wardrobe } from './Wardrobe'
import { DEFAULT_COMPANION, type CompanionPreferences } from '../lib/companions'

let container: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })
function button(text: string) { return [...container.querySelectorAll('button')].find((el) => el.textContent?.includes(text))! }
async function click(text: string) { await act(async () => button(text).click()) }
function mount(points = { golden: 30, tuxedo: 150 }, onChange = vi.fn(async (_next: CompanionPreferences) => true)) {
  let prefs: CompanionPreferences = { ...DEFAULT_COMPANION, outfits: { golden: 'natural', tuxedo: 'space' } }
  const onClose = vi.fn()
  const render = () => root.render(createElement(Wardrobe, { preferences: prefs, points, disabled: false, onClose, onChange: async (next) => {
    const result = await onChange(next)
    if (result) { prefs = next; render() }
    return result
  } }))
  act(render)
  return { onChange, onClose }
}
it('previews locked outfits without equipping, equips and removes unlocked clothes independently', async () => {
  const { onChange } = mount()
  await click('森林探险服')
  expect(container.querySelector('.wardrobe-preview [data-outfit]')?.getAttribute('data-outfit')).toBe('explorer')
  expect(button('150 成长解锁').disabled).toBe(false) // inventory preview remains available
  expect(container.querySelector<HTMLButtonElement>('.wardrobe-actions .primary-button')!.disabled).toBe(true)
  expect(onChange).not.toHaveBeenCalled()
  await click('飞行夹克'); await click('装备这套')
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ petId: 'golden', outfits: { golden: 'bomber', tuxedo: 'space' } }))
  await click('点点'); expect(container.querySelector('.wardrobe-preview [data-outfit]')?.getAttribute('data-outfit')).toBe('space')
  await click('卸下上衣')
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ outfits: { golden: 'bomber', tuxedo: 'natural' } }))
  expect(container.querySelectorAll('.equipment-slot[aria-disabled=true]')).toHaveLength(3)
})
it('keeps the wardrobe open and the equipped outfit unchanged when persistence fails', async () => {
  const { onClose } = mount(undefined, vi.fn(async (_next: CompanionPreferences) => false))
  await click('飞行夹克'); await click('装备这套')
  expect(container.querySelector('[role=status]')?.textContent).toContain('未能保存')
  expect(container.querySelector('.equipment-slot.equipped')?.textContent).toContain('原始造型')
  expect(onClose).not.toHaveBeenCalled()
  act(() => container.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
  expect(onClose).toHaveBeenCalledOnce()
})
