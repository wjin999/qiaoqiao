import { describe, expect, it } from 'vitest'
import lessonData from '../data/egg-rolls.json'
import englishData from '../data/english-sample.json'
import { DECK_IDS } from './decks'
import type { Lesson, LessonItem } from '../types'
import { formatDuration, sampleItems } from './practice'

const items: LessonItem[] = [
  {
    id: '1',
    nativeText: '一。',
    text: '一。',
    ruby: [{ text: '一', reading: 'いち' }, { text: '。' }],
  },
  {
    id: '2',
    nativeText: '二。',
    text: '二。',
    ruby: [{ text: '二', reading: 'に' }, { text: '。' }],
  },
  {
    id: '3',
    nativeText: '三。',
    text: '三。',
    ruby: [{ text: '三', reading: 'さん' }, { text: '。' }],
  },
]

const japaneseLesson = lessonData as Lesson

describe('sampleItems', () => {
  it('returns no more than the requested number without changing the source', () => {
    const result = sampleItems(items, 2, () => 0)

    expect(result).toHaveLength(2)
    expect(new Set(result.map((item) => item.id)).size).toBe(2)
    expect(items.map((item) => item.id)).toEqual(['1', '2', '3'])
  })
})

describe('Japanese lesson data', () => {
  it('ships the attributed egg rolls library with unique source ids', () => {
    expect(japaneseLesson.id).toBe(DECK_IDS.ja)
    expect(japaneseLesson.items).toHaveLength(15891)
    expect(new Set(japaneseLesson.items.map((item) => item.id)).size).toBe(15891)
    expect(japaneseLesson.metadata).toMatchObject({ author: 'egg rolls', license: 'CC BY-NC 4.0', noteCount: 10635, builtIn: true })
  })
  it('keeps the displayed ruby text identical to the typing target', () => {
    for (const item of japaneseLesson.items) {
      expect(item.ruby.map((part) => part.text).join('')).toBe(item.text)
      expect(item.nativeText.length).toBeGreaterThan(0)
    }
  })
})

describe('English sample deck', () => {
  const english = englishData as Lesson
  it('is the English deck, with unique ids and a Chinese line for every sentence', () => {
    expect(english).toMatchObject({ id: DECK_IDS.en, targetLanguage: 'en', nativeLanguage: 'zh-CN' })
    expect(new Set(english.items.map((item) => item.id)).size).toBe(english.items.length)
    for (const item of english.items) {
      expect(item.ruby).toEqual([{ text: item.text }])
      expect(item.nativeText.length).toBeGreaterThan(0)
      // Plain ASCII, so every sentence can be typed on any keyboard layout.
      expect(item.text).toMatch(/^[\x20-\x7e]+$/)
    }
  })
})

describe('formatDuration', () => {
  it('formats milliseconds as minutes and seconds', () => {
    expect(formatDuration(65_000)).toBe('1:05')
  })
})
