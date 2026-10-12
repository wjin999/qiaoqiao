import { createEmptyCard, fsrs, type Card, type Grade } from 'ts-fsrs'
import type { LessonItem } from '../types'

export type PracticeMode = 'memory' | 'free'
export type SavedCard = Omit<Card, 'due' | 'last_review'> & { due: string; last_review?: string }
export interface SentenceProgress {
  id: string
  lessonId: string
  sentenceId: string
  sourceNoteId?: string
  introducedAt: string
  updatedAt: string
  card: SavedCard
}
export interface ReviewEntry {
  id: string
  lessonId: string
  sentenceId: string
  reviewedAt: string
  mode: PracticeMode
  rating: Grade | null
  hintUsed: boolean
  elapsedMs: number
}

// Fix parameters for reproducible previews, backups and reviews across devices.
export const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false,
  learning_steps: ['1m', '10m'], relearning_steps: ['10m'] })
export const GRADES = [1, 2, 3, 4] as const
export const GRADE_LABELS = ['重来', '困难', '良好', '简单'] as const
export const sentenceKey = (lessonId: string, sentenceId: string) => JSON.stringify([lessonId, sentenceId])

export function saveCard(card: Card): SavedCard {
  return { ...card, due: card.due.toISOString(), last_review: card.last_review?.toISOString() }
}

export function reviewSentence(previous: SentenceProgress | undefined, lessonId: string,
  item: LessonItem, grade: Grade, now: Date): SentenceProgress {
  const next = scheduler.next(previous?.card ?? createEmptyCard(now), now, grade).card
  return { id: sentenceKey(lessonId, item.id), lessonId, sentenceId: item.id,
    sourceNoteId: item.sourceNoteId, introducedAt: previous?.introducedAt ?? now.toISOString(),
    updatedAt: now.toISOString(), card: saveCard(next) }
}

export function ratingIntervals(previous: SentenceProgress | undefined, now: Date): string[] {
  const outcomes = scheduler.repeat(previous?.card ?? createEmptyCard(now), now)
  return GRADES.map((grade) => {
    const minutes = Math.max(1, Math.round((outcomes[grade].card.due.getTime() - now.getTime()) / 60000))
    if (minutes < 60) return `${minutes} 分钟`
    if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`
    return `${Math.round(minutes / 1440)} 天`
  })
}

export function studyPlan(items: LessonItem[], lessonId: string, progress: SentenceProgress[],
  dailyNewLimit: number, now = new Date(), limit = 10) {
  const cards = progress.filter((entry) => entry.lessonId === lessonId)
  const byId = new Map(cards.map((entry) => [entry.sentenceId, entry]))
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0)
  const introducedToday = cards.filter((entry) => Date.parse(entry.introducedAt) >= dayStart.getTime()).length
  const newRemaining = Math.max(0, dailyNewLimit - introducedToday)
  const due = items.filter((item) => {
    const progress = byId.get(item.id)
    return progress && Date.parse(progress.card.due) <= now.getTime()
  }).sort((a, b) => Date.parse(byId.get(a.id)!.card.due) - Date.parse(byId.get(b.id)!.card.due))
  const unseen = items.filter((item) => !byId.has(item.id))
  const queue: LessonItem[] = []
  const notes = new Set<string>()
  let newCount = 0
  for (const item of [...due, ...unseen]) {
    if (queue.length >= limit) break
    if (!byId.has(item.id) && newCount >= newRemaining) continue
    const note = item.sourceNoteId ?? item.id
    if (notes.has(note)) continue
    notes.add(note); queue.push(item)
    if (!byId.has(item.id)) newCount++
  }
  const nextDue = items.flatMap((item) => {
    const entry = byId.get(item.id)
    return entry && Date.parse(entry.card.due) > now.getTime() ? [Date.parse(entry.card.due)] : []
  }).sort((a, b) => a - b)[0]
  return { queue, dueCount: due.length, newCount, introducedToday, newRemaining, nextDue }
}
