// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Session } from '@supabase/supabase-js'
import App from './App'
import { AccountProvider } from './components/Account'
import { getAccountScope, setAccountScope } from './lib/account-scope'
import { exportProgress, pendingChanges } from './lib/storage'
import { PET_PREFERENCE_KEY, petGrowth } from './lib/companions'

const network = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: string, session: Session | null) => void),
  push: vi.fn(), pull: vi.fn(),
}))
vi.mock('./lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: (listener: typeof network.listener) => {
    network.listener = listener; listener?.('INITIAL_SESSION', null)
    return { data: { subscription: { unsubscribe() {} } } }
  } } },
  authRedirect: () => 'https://example.com/', accountError: () => '网络请求失败。',
}))
vi.mock('./lib/cloud-sync', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/cloud-sync')>(),
  cloudTransport: () => ({ push: network.push, pull: network.pull }),
}))
vi.mock('./lib/default-deck', () => ({ loadDefaultDeck: async () => ({
  schemaVersion: 2, id: 'test-deck', title: '测试卡组', nativeLanguage: 'zh-CN', targetLanguage: 'ja',
  items: [0, 1].map((index) => ({ id: `sentence-${index}`, text: `猫${index}。`, nativeText: '猫', ruby: [{ text: `猫${index}。` }] })),
}) }))

let container: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('indexedDB', new IDBFactory()); localStorage.clear(); setAccountScope(null)
  network.push.mockReset().mockResolvedValue(undefined); network.pull.mockReset().mockResolvedValue([])
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setAccountScope(null) })
const button = (text: string) => [...container.querySelectorAll('button')].find((node) => node.textContent?.includes(text))!
async function until(check: () => boolean) {
  for (let i = 0; i < 150; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
    if (check()) return
  }
  throw new Error('Round sync UI did not settle')
}
async function mount(loggedIn = true) {
  await act(async () => root.render(createElement(StrictMode, null, createElement(AccountProvider, null, createElement(App)))))
  if (loggedIn) await act(async () => network.listener?.('SIGNED_IN', {
    user: { id: crypto.randomUUID(), email: 'learner@example.com' }, access_token: 'test-token',
  } as Session))
  await until(() => !!button('开始练习') && !button('开始练习').disabled)
}
async function start() { act(() => button('开始练习').click()); await until(() => !!container.querySelector('#typing-input')) }
async function finishSentence(free = false) {
  const input = container.querySelector<HTMLInputElement>('#typing-input')!
  const sentence = container.querySelector('.sentence')!.getAttribute('aria-label')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, sentence)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: free ? 'Enter' : '4', bubbles: true, cancelable: true })))
  await until(() => !!container.querySelector('.result-screen') || container.querySelector('#typing-input')?.getAttribute('value') === '')
}

it.each([false, true])('syncs a completed round once after all learning and pet records are persisted (free=%s)', async (free) => {
  await mount()
  act(() => button('点点').click()); await until(() => button('点点').getAttribute('aria-pressed') === 'true')
  if (free) act(() => button('自由跟打').click())
  await start(); await finishSentence(free)
  expect(network.push).not.toHaveBeenCalled(); expect(network.pull).not.toHaveBeenCalled()
  let release!: () => void
  network.push.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
  await finishSentence(free); await until(() => network.push.mock.calls.length === 1)
  expect(button('再来一组').disabled).toBe(true)
  expect(container.querySelector('.result-subtitle')?.textContent).toContain('正在同步')
  const batch = network.push.mock.calls[0]![0]
  expect(batch.filter((row: any) => row.kind === 'review')).toHaveLength(2)
  expect(batch.filter((row: any) => row.kind === 'review').every((row: any) => row.value.petId === 'tuxedo')).toBe(true)
  expect(batch).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'setting', key: PET_PREFERENCE_KEY, value: expect.stringContaining('tuxedo') }),
    expect.objectContaining({ kind: 'history', value: expect.objectContaining({ sentenceCount: 2, partial: false }) }),
  ]))
  expect(petGrowth((await exportProgress()).reviews)).toEqual({ golden: 0, tuxedo: 2 })
  await act(async () => release()); await until(() => container.textContent?.includes('已同步') ?? false)
  expect(await pendingChanges(getAccountScope()!)).toHaveLength(0)
  act(() => button('回到主页').click())
  expect(network.push).toHaveBeenCalledTimes(1); expect(network.pull).toHaveBeenCalledTimes(1)
})

it('keeps a failed round queued and allows manual retry without looping', async () => {
  network.push.mockRejectedValueOnce(new Error('offline'))
  await mount(); await start(); await finishSentence(); await finishSentence()
  await until(() => container.textContent?.includes('同步未完成') ?? false)
  expect(network.push).toHaveBeenCalledTimes(1)
  expect((await exportProgress()).reviews).toHaveLength(2)
  expect((await pendingChanges(getAccountScope()!)).length).toBeGreaterThan(0)
  act(() => button('同步').click())
  await until(() => container.textContent?.includes('已同步') ?? false)
  expect(network.push).toHaveBeenCalledTimes(2); expect(await pendingChanges(getAccountScope()!)).toHaveLength(0)
})

it('keeps offline completion local and syncs accumulated progress on the next completed round', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  await mount(); act(() => button('自由跟打').click()); await start(); await finishSentence(true); await finishSentence(true)
  await until(() => container.textContent?.includes('联网后可点击同步') ?? false)
  expect(network.push).not.toHaveBeenCalled(); expect((await pendingChanges(getAccountScope()!)).length).toBeGreaterThan(0)
  online.mockReturnValue(true)
  act(() => window.dispatchEvent(new Event('online')))
  expect(network.push).not.toHaveBeenCalled()
  act(() => button('再来一组').click()); await until(() => !!container.querySelector('#typing-input'))
  await finishSentence(true); await finishSentence(true)
  await until(() => container.textContent?.includes('已同步') ?? false)
  expect(network.push).toHaveBeenCalledTimes(1)
  expect((await exportProgress()).reviews).toHaveLength(4); expect(await pendingChanges(getAccountScope()!)).toHaveLength(0)
})

it('does not sync an unfinished round or a guest round', async () => {
  await mount(); await start(); await finishSentence()
  act(() => button('日语敲敲').click())
  expect(network.push).not.toHaveBeenCalled()
  await act(async () => network.listener?.('SIGNED_OUT', null))
  await until(() => !!button('开始练习') && !button('开始练习').disabled)
  await start(); await finishSentence(); await finishSentence()
  expect(container.querySelector('.result-screen')).not.toBeNull()
  expect(network.push).not.toHaveBeenCalled(); expect(network.pull).not.toHaveBeenCalled()
})
