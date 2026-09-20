import { exportProgress, mergeProgress, validHistoryEntry, type ProgressData } from './storage'
import { sentenceKey, type ReviewEntry, type SentenceProgress } from './scheduler'
import { isPetId } from './companions'
export type { ProgressData } from './storage'

// This is an import memory safeguard, not a limit on stored learning history.
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2000
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const counter = (value: unknown) => nonnegative(value) && Number.isSafeInteger(value)

export function validCard(value: unknown): value is SentenceProgress {
  if (!value || typeof value !== 'object') return false
  const entry = value as SentenceProgress
  const card = entry.card
  return validId(entry.lessonId) && validId(entry.sentenceId)
    && entry.id === sentenceKey(entry.lessonId, entry.sentenceId)
    && (entry.sourceNoteId === undefined || validId(entry.sourceNoteId))
    && validDate(entry.introducedAt) && validDate(entry.updatedAt)
    && Date.parse(entry.introducedAt) <= Date.parse(entry.updatedAt)
    && !!card && typeof card === 'object' && validDate(card.due) && validDate(card.last_review)
    && card.last_review === entry.updatedAt && Date.parse(card.due) >= Date.parse(entry.updatedAt)
    && nonnegative(card.stability) && card.stability > 0
    && nonnegative(card.difficulty) && card.difficulty >= 1 && card.difficulty <= 10
    && counter(card.elapsed_days) && counter(card.scheduled_days) && counter(card.learning_steps)
    && counter(card.reps) && card.reps > 0 && counter(card.lapses) && card.lapses <= card.reps
    && [1, 2, 3].includes(card.state)
}

export function validReview(value: unknown): value is ReviewEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as ReviewEntry
  return validId(entry.id) && validId(entry.lessonId) && validId(entry.sentenceId)
    && validDate(entry.reviewedAt) && nonnegative(entry.elapsedMs) && typeof entry.hintUsed === 'boolean'
    && (entry.petId === undefined || isPetId(entry.petId))
    && ((entry.mode === 'free' && entry.rating === null)
      || (entry.mode === 'memory' && entry.rating !== null && [1, 2, 3, 4].includes(entry.rating)))
}

function newest<T extends { id: string }>(entries: T[], date: (entry: T) => string): T[] {
  const byId = new Map<string, T>()
  for (const entry of entries) {
    const old = byId.get(entry.id)
    if (!old || Date.parse(date(entry)) >= Date.parse(date(old))) byId.set(entry.id, entry)
  }
  return [...byId.values()]
}

export function serializeProgress(progress: ProgressData): string {
  return JSON.stringify({ format: 'typelingo-progress', version: 2,
    scheduler: 'ts-fsrs-5.4.2-default-r90', exportedAt: new Date().toISOString(), ...progress })
}

export function parseProgress(source: string): ProgressData {
  if (source.length > MAX_BACKUP_BYTES || new TextEncoder().encode(source).length > MAX_BACKUP_BYTES) {
    throw new Error('备份超过 256 MB 的单文件恢复上限。')
  }
  let value
  try { value = JSON.parse(source) } catch { throw new Error('文件不是有效的 JSON 进度备份。') }
  if (!value || value.format !== 'typelingo-progress' || ![1, 2].includes(value.version)) {
    throw new Error('请选择日语敲敲（原 TypeLingo）导出的进度备份（版本 1 或 2）。')
  }
  if (!Array.isArray(value.history) || !value.history.every(validHistoryEntry)
    || !Array.isArray(value.permanentlySkippedSentenceIds) || !value.permanentlySkippedSentenceIds.every(validId)) {
    throw new Error('进度文件包含无效的成绩或跳过记录。')
  }
  const cards = value.version === 1 ? [] : value.cards
  const reviews = value.version === 1 ? [] : value.reviews
  if (value.version === 2 && value.scheduler !== 'ts-fsrs-5.4.2-default-r90') {
    throw new Error('此备份使用了不兼容的复习算法版本，请使用对应版本的日语敲敲恢复。')
  }
  if (!Array.isArray(cards) || !cards.every(validCard) || !Array.isArray(reviews) || !reviews.every(validReview)) {
    throw new Error('进度文件包含无效的复习计划或逐句记录。')
  }
  return {
    history: newest(value.history, (entry) => entry.completedAt),
    permanentlySkippedSentenceIds: [...new Set<string>(value.permanentlySkippedSentenceIds)],
    cards: newest<SentenceProgress>(cards, (entry) => entry.updatedAt),
    reviews: newest<ReviewEntry>(reviews, (entry) => entry.reviewedAt),
  }
}

export async function restoreProgress(source: string): Promise<ProgressData> {
  const imported = parseProgress(source)
  await mergeProgress(imported)
  return exportProgress()
}
