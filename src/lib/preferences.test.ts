// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { setAccountScope } from './account-scope'
import { PET_PREFERENCE_KEY } from './companions'
import { savePreference, preference } from './preferences'
import { loadSettings } from './storage'

afterEach(() => { setAccountScope(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })
it('persists guest wardrobe choices and reports a full guest store instead of claiming success', async () => {
  setAccountScope(null)
  const value = '{"outfits":{"golden":"bomber"}}'
  await savePreference(PET_PREFERENCE_KEY, value)
  expect(preference(PET_PREFERENCE_KEY, '')).toBe(value)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
  await expect(savePreference(PET_PREFERENCE_KEY, '{}')).rejects.toThrow('full')
  expect(preference(PET_PREFERENCE_KEY, '')).toBe(value)
})
it('keeps account outfits in IndexedDB when the optional localStorage cache is unavailable', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); setAccountScope('wardrobe-test')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  const value = '{"outfits":{"tuxedo":"space"}}'
  await savePreference(PET_PREFERENCE_KEY, value)
  expect((await loadSettings())[PET_PREFERENCE_KEY]).toBe(value)
})
