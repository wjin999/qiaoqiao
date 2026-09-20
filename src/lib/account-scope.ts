let accountId: string | null = null
export const LOCAL_CHANGED = 'qiaoqiao:local-changed'
export const CLOUD_APPLIED = 'qiaoqiao:cloud-applied'
export function setAccountScope(id: string | null) { accountId = id }
export function getAccountScope() { return accountId }
export function scopedDatabase(name: string, account = accountId) {
  return account ? `${name}.account.${account}` : name
}
export function notifyLocalChange() {
  window.dispatchEvent?.(new CustomEvent(LOCAL_CHANGED, { detail: accountId }))
}
