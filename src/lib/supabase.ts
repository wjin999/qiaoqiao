import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://impjceezjrvmgqpwuttu.supabase.co'
export const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
// Only a publishable/anon key belongs in the browser bundle.
export const supabase = publishableKey ? createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(30000) }) },
}) : null
export const authRedirect = () => `${window.location.origin}${window.location.pathname}`

export function accountError(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error)
  if (/Invalid login credentials/i.test(message)) return '邮箱或密码不正确。'
  if (/same password|different from the old|same_password/i.test(message)) return '新密码不能与当前密码相同。'
  if (/weak_password|password.*(least|characters|weak|requirements)/i.test(message)) return '密码不符合服务器要求。本站最低为 6 个字符；若仍被拒绝，请联系站长检查密码设置。'
  if (/Email not confirmed/i.test(message)) return '请先在邮件中验证邮箱，再登录。'
  if (/rate limit|over_email_send_rate_limit|email rate/i.test(message)) return '操作过于频繁，请稍后重试。'
  if (/Email address not authorized|Error sending/i.test(message)) return '注册邮件暂时无法发送，请稍后重试或联系站长。'
  if (/device_clock_ahead/i.test(message)) return '设备时间快于服务器，请校准系统时间后重试；本地记录已保留。'
  if (/卡组文本超过/.test(message)) return message
  if (/quota|too_large/i.test(message)) return '已达到云同步容量限制，本地记录仍保留，请导出备份并联系站长。'
  if (/qiaoqiao_|schema cache|PGRST202/i.test(message)) return '云同步服务尚未配置完成，本地练习仍可使用。'
  if (/fetch|network|timeout|abort/i.test(message)) return '连接失败，本地记录已保留，联网后可重试。'
  return '操作未完成，请重试；如持续失败，请联系站长。'
}
