// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { setAccountScope } from './account-scope'
import { savePreference, preference } from './preferences'
import { loadSettings } from './storage'

afterEach(() => { setAccountScope(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })
it('persists guest preferences and reports a full guest store instead of claiming success', async () => {
  setAccountScope(null)
  await savePreference('typelingo.mode', 'free')
  expect(preference('typelingo.mode', 'memory')).toBe('free')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
  await expect(savePreference('typelingo.mode', 'memory')).rejects.toThrow('full')
  expect(preference('typelingo.mode', 'memory')).toBe('free')
})
it('keeps account preferences in IndexedDB when the optional localStorage cache is unavailable', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); setAccountScope('preference-test')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  await savePreference('typelingo.daily-new', '25')
  expect((await loadSettings())['typelingo.daily-new']).toBe('25')
})
it('does not store the retired companion preference', async () => {
  setAccountScope(null)
  await savePreference('qiaoqiao.companion.v1', '{}')
  expect(localStorage.getItem('qiaoqiao.companion.v1')).toBeNull()
})
