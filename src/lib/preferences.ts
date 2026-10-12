import { getAccountScope } from './account-scope'
import { loadSettings, storeSetting } from './storage'

// Settings stay on each device (accounts keep a copy in their local database); they are not synced.
export const LANGUAGE_KEY = 'qiaoqiao.language.v1'
export const isPreference = (key: string) => ['typelingo.mode', 'typelingo.daily-new', LANGUAGE_KEY].includes(key) || key.startsWith('typelingo.deck-level.v1:')
const cacheKey = (key: string) => getAccountScope() ? `qiaoqiao.account.${getAccountScope()}:${key}` : key
const memory = new Map<string, string>()
export function preference(key: string, fallback: string): string {
  if (getAccountScope() && memory.has(cacheKey(key))) return memory.get(cacheKey(key))!
  try { return localStorage.getItem(cacheKey(key)) ?? fallback } catch { return fallback }
}
export async function savePreference(key: string, value: string) {
  if (!isPreference(key)) return
  const cache = cacheKey(key)
  const account = getAccountScope()
  if (account) await storeSetting(key, value)
  try { localStorage.setItem(cache, value) } catch (error) {
    // Accounts have an authoritative IndexedDB copy; guests do not.
    if (!account) throw error
  }
  memory.set(cache, value)
}
export async function hydratePreferences(account: string) {
  const settings = await loadSettings(account)
  if (account !== getAccountScope()) return
  for (const [key, value] of Object.entries(settings)) {
    memory.set(cacheKey(key), value)
    try { localStorage.setItem(cacheKey(key), value) } catch { /* Local storage may be unavailable. */ }
  }
}
export function guestPreferences(): Record<string, string> {
  const result: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!
      if (isPreference(key)) result[key] = localStorage.getItem(key)!
    }
  } catch { /* Guest settings are optional. */ }
  return result
}
