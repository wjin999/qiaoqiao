import japaneseUrl from '../data/egg-rolls.json?url'
import englishUrl from '../data/english-sample.json?url'
import type { Lesson, TargetLanguage } from '../types'

// One built-in deck per language. Decks ship with the site, load on demand and are never synced.
export const DECK_IDS: Record<TargetLanguage, string> = { ja: 'eggrolls-jlpt-v3.5', en: 'english-sample-v1' }
const urls: Record<TargetLanguage, string> = { ja: japaneseUrl, en: englishUrl }
const loading: Partial<Record<TargetLanguage, Promise<Lesson>>> = {}

export function loadDeck(language: TargetLanguage): Promise<Lesson> {
  return loading[language] ??= fetch(urls[language]).then(async (response) => {
    if (!response.ok) throw new Error('卡组加载失败，请检查连接后重试。')
    return await response.json() as Lesson
  }).catch((error) => { delete loading[language]; throw error })
}
