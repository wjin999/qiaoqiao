import { getAccountScope } from './account-scope'
import { loadSettings, storeSetting } from './storage'

export const isPreference = (key: string) => ['typelingo.mode', 'typelingo.daily-new', 'typelingo.selected-deck.v1'].includes(key) || key.startsWith('typelingo.deck-level.v1:')
const cacheKey = (key: string) => getAccountScope() ? `qiaoqiao.account.${getAccountScope()}:${key}` : key
const memory = new Map<string, string>()
export function preference(key: string, fallback: string): string {
  if (getAccountScope() && memory.has(cacheKey(key))) return memory.get(cacheKey(key))!
  try { return localStorage.getItem(cacheKey(key)) ?? fallback } catch { return fallback }
}
export async function savePreference(key: string, value: string) {
  if (!isPreference(key)) return
  const cache = cacheKey(key)
  if (getAccountScope()) await storeSetting(key, value)
  memory.set(cache, value)
  try { localStorage.setItem(cache, value) } catch { /* IndexedDB remains authoritative for accounts. */ }
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
