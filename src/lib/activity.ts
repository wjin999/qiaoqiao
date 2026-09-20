import type { HistoryEntry } from '../types'
import type { ReviewEntry } from './scheduler'

export interface ActivityDay { date: string; count: number; level: number }
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function buildActivity(reviews: ReviewEntry[], history: HistoryEntry[], today = new Date()) {
  const end = new Date(today); end.setHours(12, 0, 0, 0)
  const start = new Date(end); start.setDate(start.getDate() - 364)
  const first = localDateKey(start), last = localDateKey(end)
  const counts = new Map<string, number>()
  const add = (timestamp: string, count: number) => {
    const date = new Date(timestamp)
    if (!Number.isFinite(date.getTime()) || !Number.isFinite(count) || count <= 0) return
    const key = localDateKey(date)
    if (key >= first && key <= last) counts.set(key, (counts.get(key) ?? 0) + count)
  }
  const representedRounds = new Set<string>()
  for (const review of new Map(reviews.map((entry) => [entry.id, entry])).values()) {
    add(review.reviewedAt, 1)
    const separator = review.id.lastIndexOf(':')
    if (separator > 0) representedRounds.add(review.id.slice(0, separator))
  }
  // Old versions only kept round summaries. Use those where no sentence log
  // exists, without counting modern rounds twice.
  for (const entry of new Map(history.map((round) => [round.id, round])).values()) {
    if (!representedRounds.has(entry.id)) add(entry.completedAt, entry.sentenceCount)
  }
  const days: ActivityDay[] = []
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const key = localDateKey(date), count = counts.get(key) ?? 0
    days.push({ date: key, count, level: count === 0 ? 0 : count < 5 ? 1 : count < 10 ? 2 : count < 20 ? 3 : 4 })
  }
  return { days, leading: (start.getDay() + 6) % 7, total: days.reduce((sum, day) => sum + day.count, 0), activeDays: days.filter((day) => day.count > 0).length }
}
