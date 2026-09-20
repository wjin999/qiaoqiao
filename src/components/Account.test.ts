// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Session } from '@supabase/supabase-js'
import { AccountButton, AccountProvider, useAccount } from './Account'
import { getAccountScope, setAccountScope } from '../lib/account-scope'

const mock = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: string, session: Session | null) => void),
  login: vi.fn(), signup: vi.fn(), reset: vi.fn(), update: vi.fn(), signout: vi.fn(),
}))
vi.mock('../lib/supabase', () => ({
  supabase: { auth: {
    onAuthStateChange: (listener: typeof mock.listener) => { mock.listener = listener; listener?.('INITIAL_SESSION', null); return { data: { subscription: { unsubscribe() {} } } } },
    signInWithPassword: mock.login, signUp: mock.signup, resetPasswordForEmail: mock.reset, updateUser: mock.update, signOut: mock.signout,
  } },
  authRedirect: () => 'https://example.com/', accountError: () => '操作失败，请重试。',
}))
vi.mock('../lib/cloud-sync', () => ({ syncAccount: async () => {}, cloudTransport: () => ({}) }))
let container: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('indexedDB', new IDBFactory()); localStorage.clear(); setAccountScope(null)
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  mock.login.mockResolvedValue({ error: null }); mock.signup.mockResolvedValue({ data: { session: null }, error: null })
  mock.reset.mockResolvedValue({ error: null }); mock.update.mockResolvedValue({ error: null })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); setAccountScope(null) })
function button(text: string) { return [...container.querySelectorAll('button')].find((item) => item.textContent === text)! }
function fill(label: string, value: string) {
  const input = [...container.querySelectorAll('label')].find((node) => node.textContent?.startsWith(label))!.querySelector('input')!
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function submit() { await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }) }
async function until(check: () => boolean) {
  for (let index = 0; index < 100; index++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
    if (check()) return
  }
  throw new Error('Account UI did not settle')
}
async function mount() {
  function View() { const account = useAccount(); return createElement('section', null, createElement('output', null, account.session?.user.id || 'guest'), createElement(AccountButton)) }
  await act(async () => { root.render(createElement(AccountProvider, null, createElement(View))) })
  act(() => button('登录 / 注册').click())
}
describe('account flows', () => {
  it('submits email/password login and separates the active account after auth changes', async () => {
    await mount(); fill('邮箱', 'learner@example.com'); fill('密码', 'test-password'); await submit()
    expect(mock.login).toHaveBeenCalledWith({ email: 'learner@example.com', password: 'test-password' })
    await act(async () => { mock.listener?.('SIGNED_IN', { user: { id: 'account-a', email: 'learner@example.com' }, access_token: 'test-token' } as Session) })
    await until(() => container.querySelector('output')?.textContent === 'account-a')
    expect(getAccountScope()).toBe('account-a'); expect(container.querySelector('output')?.textContent).toBe('account-a')
    await act(async () => { mock.listener?.('SIGNED_OUT', null) })
    expect(getAccountScope()).toBe(null); expect(container.querySelector('output')?.textContent).toBe('guest')
  })
  it('shows email verification guidance instead of claiming signup is complete', async () => {
    await mount(); act(() => button('注册新账号').click()); fill('邮箱', 'learner@example.com'); fill('密码', 'test-password'); await submit()
    expect(mock.signup).toHaveBeenCalledWith(expect.objectContaining({ options: { emailRedirectTo: 'https://example.com/' } }))
    expect(container.textContent).toContain('完成验证后登录')
  })
  it('handles forgot-password requests without exposing whether an email exists', async () => {
    await mount(); act(() => button('忘记密码').click()); fill('邮箱', 'learner@example.com'); await submit()
    expect(mock.reset).toHaveBeenCalledWith('learner@example.com', { redirectTo: 'https://example.com/' })
    expect(container.textContent).toContain('若该邮箱已注册')
  })
  it('opens a password form on the recovery callback and clears it after success', async () => {
    await mount()
    await act(async () => { mock.listener?.('PASSWORD_RECOVERY', { user: { id: 'account-a', email: 'learner@example.com' }, access_token: 'test-token' } as Session) })
    await until(() => container.textContent?.includes('新密码') ?? false)
    fill('新密码', 'a-new-password'); await submit()
    expect(mock.update).toHaveBeenCalledWith({ password: 'a-new-password' })
    expect(container.textContent).toContain('密码已更新')
  })
})
