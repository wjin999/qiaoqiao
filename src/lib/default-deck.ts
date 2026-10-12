import deckUrl from '../data/egg-rolls.json?url'
import type { Lesson } from '../types'

export const DEFAULT_DECK_ID = 'eggrolls-jlpt-v3.5'
let pending: Promise<Lesson> | undefined

export function loadDefaultDeck(): Promise<Lesson> {
  pending ??= fetch(deckUrl).then(async (response) => {
    if (!response.ok) throw new Error('默认卡组加载失败，请检查连接后重试。')
    return await response.json() as Lesson
  }).catch((error) => { pending = undefined; throw error })
  return pending
}
