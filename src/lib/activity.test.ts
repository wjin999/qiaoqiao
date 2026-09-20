import { describe, expect, it } from 'vitest'
import { buildActivity, localDateKey } from './activity'
import type { ReviewEntry } from './scheduler'
import type { HistoryEntry } from '../types'

const today = new Date(2026, 8, 20, 16)
const review = (id: string, date = today, mode: 'free' | 'memory' = 'memory'): ReviewEntry => ({ id, reviewedAt: date.toISOString(), lessonId: 'deck', sentenceId: 'same-sentence', mode, rating: mode === 'free' ? null : 3, hintUsed: false, elapsedMs: 1000 })
const round = (id: string, sentenceCount: number): HistoryEntry => ({ id, completedAt: today.toISOString(), lessonId: 'deck', sentenceCount, elapsedMs: 10000 })

describe('learning activity', () => {
  it('counts repeated practice and both modes, without double-counting synced logs or round summaries', () => {
    const records = [review('round-a:0'), review('round-a:1', today, 'free')]
    const result = buildActivity([...records, records[0]!], [round('round-a', 2), round('legacy', 5), round('legacy', 5)], today)
    expect(result.total).toBe(7)
    expect(result.activeDays).toBe(1)
    expect(result.days.at(-1)).toEqual({ date: '2026-09-20', count: 7, level: 2 })
  })
  it('uses local calendar dates and excludes records outside the past 365 days', () => {
    const first = new Date(2025, 8, 21, 0, 1), old = new Date(2025, 8, 20, 23, 59), tomorrow = new Date(2026, 8, 21)
    const result = buildActivity([review('a:0', first), review('b:0', old), review('c:0', tomorrow), review('d:0', new Date(2026, 8, 20, 0, 1))], [], today)
    expect(result.days).toHaveLength(365)
    expect(result.days[0]?.date).toBe(localDateKey(first))
    expect(result.total).toBe(2)
    expect(result.leading).toBe(6)
  })
  it('includes leap day and keeps an empty year selectable', () => {
    const result = buildActivity([], [], new Date(2024, 2, 1))
    expect(result.days).toHaveLength(365)
    expect(result.days.some((day) => day.date === '2024-02-29')).toBe(true)
    expect(new Set(result.days.map((day) => day.date)).size).toBe(365)
    expect(result.total).toBe(0)
  })
})
