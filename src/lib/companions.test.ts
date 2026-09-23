import { expect, it } from 'vitest'
import { parseProgress, serializeProgress, validReview } from './progress-backup'
import type { ReviewEntry } from './scheduler'

it('preserves learning records from before and during the retired companion release', () => {
  const review: ReviewEntry = { id: 'round:1', lessonId: 'deck', sentenceId: 'sentence', reviewedAt: '2026-09-20T10:00:00Z', mode: 'memory', rating: 1, hintUsed: true, elapsedMs: 5000, petId: 'mole' }
  const old = { ...review, id: 'old', petId: undefined }
  expect(validReview(old)).toBe(true)
  expect(validReview({ ...review, petId: 'unknown' })).toBe(false)
  const backup = parseProgress(serializeProgress({ reviews: [old, review], cards: [], history: [], permanentlySkippedSentenceIds: [] }))
  expect(backup.reviews).toEqual([old, review])
})
