import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { accountError, authRedirect, supabase } from '../lib/supabase'
import { CLOUD_APPLIED, getAccountScope, LOCAL_CHANGED, setAccountScope } from '../lib/account-scope'
import { cloudTransport, syncAccount } from '../lib/cloud-sync'
import { exportProgress, mergeProgress, pendingChanges, storeDeck, storeSetting } from '../lib/storage'
import { guestPreferences, hydratePreferences } from '../lib/preferences'
import { loadImportedDecks } from '../lib/deck-storage'
import { Modal } from './Modal'

const AccountContext = createContext<{
  session: Session | null; syncing: boolean; status: string; recovery: boolean
  setPracticing: (busy: boolean) => void; sync: () => Promise<void>; clearRecovery: () => void
}>({ session: null, syncing: false, status: '', recovery: false, setPracticing: () => {}, sync: async () => {}, clearRecovery: () => {} })
export const useAccount = () => useContext(AccountContext)

export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [initialized, setInitialized] = useState(!supabase)
  const [readyFor, setReadyFor] = useState<string | null | undefined>(supabase ? undefined : null)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [setupError, setSetupError] = useState('')
  const [retry, setRetry] = useState(0)
  const practicing = useRef(false)
  const running = useRef(false)
  const currentSession = useRef(session); currentSession.current = session
  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next); setInitialized(true)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!initialized) return
    let active = true
    setAccountScope(userId); practicing.current = false; setSetupError(''); setStatus('')
    void (userId ? hydratePreferences(userId) : Promise.resolve()).then(() => {
      if (active) setReadyFor(userId)
    }).catch(() => { if (active) setSetupError('无法打开账号的本地记录，请检查浏览器存储设置后重试。') })
    return () => { active = false }
  }, [initialized, userId, retry])

  const sync = useCallback(async () => {
    const current = currentSession.current
    if (!current || running.current || practicing.current || getAccountScope() !== current.user.id) return
    if (!navigator.onLine) { setStatus('离线 · 记录保存在本机'); return }
    running.current = true; setSyncing(true); setStatus('正在同步…')
    try {
      await syncAccount(current.user.id, cloudTransport(current.access_token))
      if (currentSession.current?.user.id !== current.user.id) return
      await hydratePreferences(current.user.id)
      window.dispatchEvent(new Event(CLOUD_APPLIED))
      const pending = await pendingChanges(current.user.id)
      setStatus(pending.length ? '有新记录待同步' : `已同步 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`)
    } catch (error) {
      if (currentSession.current?.user.id === current.user.id) setStatus(`同步未完成：${accountError(error)}`)
    } finally { running.current = false; setSyncing(false) }
  }, [])

  useEffect(() => {
    if (!userId || readyFor !== userId) return
    let timer: number | undefined
    const queue = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { void sync() }, 1500)
    }
    const changed = () => { setStatus('本机有更新 · 待同步'); queue() }
    const offline = () => setStatus('离线 · 记录保存在本机')
    queue()
    const periodic = window.setInterval(() => { if (document.visibilityState === 'visible') void sync() }, 60000)
    window.addEventListener(LOCAL_CHANGED, changed); window.addEventListener('online', queue)
    window.addEventListener('focus', queue); window.addEventListener('offline', offline)
    return () => {
      window.clearTimeout(timer); window.clearInterval(periodic)
      window.removeEventListener(LOCAL_CHANGED, changed); window.removeEventListener('online', queue)
      window.removeEventListener('focus', queue); window.removeEventListener('offline', offline)
    }
  }, [userId, readyFor, sync])
  const setPracticing = useCallback((busy: boolean) => {
    practicing.current = busy
    if (!busy) window.dispatchEvent(new Event(LOCAL_CHANGED))
  }, [])

  if (!initialized || readyFor !== userId || setupError) return <main className="loading-screen">
    <h1>日语敲敲</h1><p role={setupError ? 'alert' : 'status'}>{setupError || '正在打开本机记录…'}</p>
    {setupError && <button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button>}
  </main>
  return <AccountContext.Provider value={{ session, syncing, status, recovery, sync, setPracticing, clearRecovery: () => setRecovery(false) }}>
    <div key={userId ?? 'guest'}>{children}</div>
  </AccountContext.Provider>
}

export function AccountButton({ disabled = false }: { disabled?: boolean }) {
  const { session, syncing, status, recovery, sync, clearRecovery } = useAccount()
  const [open, setOpen] = useState(false)
  const [action, setAction] = useState<'login' | 'signup' | 'forgot' | 'reset' | 'delete'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [mergeConfirm, setMergeConfirm] = useState(false)
  useEffect(() => { if (recovery) { setOpen(true); setAction('reset') } }, [recovery])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (action === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (error) throw error
      } else if (action === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: authRedirect() } })
        if (error) throw error
        if (!data.session) setMessage('若邮箱可以注册，验证邮件将发送到你的邮箱。请完成验证后登录；已有账号可直接登录或找回密码。')
      } else if (action === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirect() }); if (error) throw error
        setMessage('若该邮箱已注册，你将收到重设密码邮件。')
      } else if (action === 'reset') {
        const { error } = await supabase.auth.updateUser({ password }); if (error) throw error
        clearRecovery(); setMessage('密码已更新。'); setAction('login')
      } else if (action === 'delete' && session?.user.email) {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email: session.user.email, password }); if (loginError) throw loginError
        const { error } = await supabase.rpc('qiaoqiao_delete_account'); if (error) throw error
        await supabase.auth.signOut({ scope: 'local' })
      }
      setPassword('')
    } catch (error) { setError(accountError(error)) }
    finally { setBusy(false) }
  }

  async function mergeGuest() {
    if (!session || busy) return
    const account = session.user.id
    setBusy(true); setError(''); setMessage('')
    try {
      const [progress, decks] = await Promise.all([exportProgress(null), loadImportedDecks(null)])
      await mergeProgress(progress, account)
      for (const deck of decks) await storeDeck(deck, account)
      for (const [key, value] of Object.entries(guestPreferences())) await storeSetting(key, value, account)
      await hydratePreferences(account); window.dispatchEvent(new Event(CLOUD_APPLIED))
      setMergeConfirm(false); setMessage('本机游客记录已合并，游客原记录仍保留。'); await sync()
    } catch (error) { setError(accountError(error)) }
    finally { setBusy(false) }
  }
  function choose(next: typeof action) { setAction(next); setError(''); setMessage(''); setPassword('') }
  return <div className="account-entry">
    {session && <span className="sync-status" role="status">{status || '本机记录已打开'}</span>}
    <button type="button" className="secondary-button account-button" disabled={disabled} onClick={() => setOpen(true)}>{session ? '我的账号' : '登录 / 注册'}</button>
    {open && <Modal title={session ? '我的账号' : '登录日语敲敲'} onClose={() => { if (!busy && !recovery) setOpen(false) }}>
      {!supabase ? <p>账号同步正在准备中，目前可以继续使用本地练习和备份。</p> : <div className="account-panel">
        {session && action !== 'reset' && action !== 'delete' ? <>
          <p className="account-email">{session.user.email}</p><p>{status}</p>
          <div className="backup-actions">
            <button className="primary-button" type="button" disabled={busy || syncing} onClick={() => void sync()}>立即同步</button>
            <button className="secondary-button" type="button" disabled={busy || syncing} onClick={async () => {
              setBusy(true)
              try { const { error } = await supabase!.auth.signOut({ scope: 'local' }); if (error) throw error }
              catch (error) { setError(accountError(error)) } finally { setBusy(false) }
            }}>退出登录</button>
          </div>
          <p className="backup-help">学习记录、复习安排、设置和导入卡组会同步到账号。断网时继续保存到本机；一轮结束后自动同步。</p>
          {mergeConfirm ? <div className="account-confirm"><p>将本浏览器游客模式的学习记录、设置和自定义卡组合并到当前账号。请确认这些记录属于你。</p>
            <button type="button" disabled={busy || syncing} onClick={() => void mergeGuest()}>确认合并到此账号</button>
            <button type="button" disabled={busy} onClick={() => setMergeConfirm(false)}>取消</button></div>
            : <button type="button" className="text-button" disabled={busy || syncing} onClick={() => setMergeConfirm(true)}>合并本机游客记录</button>}
          <p className="backup-help">退出后账号记录仍保存在此浏览器，但与游客和其他账号隔离。公共设备用完后请清除网站数据。</p>
          <button type="button" className="text-button danger-button" disabled={busy || syncing} onClick={() => choose('delete')}>删除账号</button>
        </> : <form onSubmit={(event) => void submit(event)}>
          {action === 'delete' ? <p>删除此账号及全部云端卡组和学习记录，无法撤销。请先导出备份，再输入当前密码确认。此操作不删除游客记录。</p>
            : action === 'reset' ? <p>设置新的登录密码。</p>
            : <label>邮箱<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
          {action !== 'forgot' && <label>{action === 'reset' ? '新密码' : '密码'}<input type="password" required minLength={action === 'login' || action === 'delete' ? 1 : 8}
            autoComplete={action === 'signup' || action === 'reset' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
          {(action === 'signup' || action === 'reset') && <p className="backup-help">至少 8 个字符。请勿与其他网站使用同一密码。</p>}
          <button className="primary-button" type="submit" disabled={busy || syncing}>{busy ? '正在处理…' : ({ login: '登录', signup: '注册', forgot: '发送重设邮件', reset: '保存新密码', delete: '确认删除账号' })[action]}</button>
          {!recovery && <div className="backup-actions">
            {action !== 'login' && <button type="button" className="text-button" onClick={() => choose('login')} disabled={busy}>返回登录</button>}
            {action === 'login' && <><button type="button" className="text-button" onClick={() => choose('signup')}>注册新账号</button><button type="button" className="text-button" onClick={() => choose('forgot')}>忘记密码</button></>}
          </div>}
        </form>}
        <p className="backup-help">注册后，邮箱及同步数据将由 Supabase 托管。卡组仅本人可访问，不上传原始 APKG 或媒体。你仍可不登录使用。</p>
        {message && <p role="status">{message}</p>}{error && <p className="error-message" role="alert">{error}</p>}
      </div>}
    </Modal>}
  </div>
}
