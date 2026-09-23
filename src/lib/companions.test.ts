import { describe, expect, it } from 'vitest'
import { companionPreferences, growthStage, petGrowth } from './companions'
import { parseProgress, serializeProgress, validReview } from './progress-backup'
import type { ReviewEntry } from './scheduler'

const review: ReviewEntry = { id: 'round:1', lessonId: 'deck', sentenceId: 'sentence', reviewedAt: '2026-09-20T10:00:00Z', mode: 'memory', rating: 1, hintUsed: true, elapsedMs: 5000, petId: 'golden' }
describe('companion growth', () => {
  it('awards one point per saved attempt regardless of grade, hint or mode, with no duplicate sync rewards', () => {
    const records: ReviewEntry[] = [1, 2, 3, 4].map((rating) => ({ ...review, id: `round:${rating}`, rating: rating as 1 | 2 | 3 | 4 }))
    records.push({ ...review, id: 'free', mode: 'free', rating: null, petId: 'tuxedo' }, { ...review, id: 'sprout', petId: 'sprout' }, review)
    expect(petGrowth(records)).toEqual({ golden: 4, tuxedo: 1 })
    expect(petGrowth([...records, ...records])).toEqual(petGrowth(records))
  })
  it('does not assign old records to an arbitrary pet and preserves independent growth in backups', () => {
    const old = { ...review, id: 'old', petId: undefined }
    const retired = { ...review, id: 'retired', petId: 'mole' as const }
    expect(validReview(old)).toBe(true)
    expect(validReview(retired)).toBe(true)
    expect(validReview({ ...review, petId: 'unknown' })).toBe(false)
    const backup = parseProgress(serializeProgress({ reviews: [old, retired, review], cards: [], history: [], permanentlySkippedSentenceIds: [] }))
    expect(backup.reviews).toEqual([old, retired, review])
    expect(petGrowth(backup.reviews)).toEqual({ golden: 1, tuxedo: 0 })
  })
  it('unlocks accessories at the exact milestones and keeps counting past the final stage', () => {
    expect(growthStage(29)).toMatchObject({ stage: 1, remaining: 1 })
    expect(growthStage(30)).toMatchObject({ stage: 2, remaining: 120, percent: 0 })
    expect(growthStage(149)).toMatchObject({ stage: 2, remaining: 1 })
    expect(growthStage(150)).toMatchObject({ stage: 3, next: null, percent: 100 })
    expect(growthStage(100000)).toMatchObject({ stage: 3, next: null, percent: 100 })
  })
  it('restores chosen companion and opt-outs, with safe defaults for old or malformed preferences', () => {
    expect(companionPreferences('{"petId":"mole","enabled":false,"animations":false}')).toEqual({ petId: 'golden', enabled: false, animations: false })
    expect(companionPreferences('{')).toEqual({ petId: 'golden', enabled: true, animations: true })
    expect(companionPreferences('{"petId":"tuxedo","enabled":false,"animations":false}')).toEqual({ petId: 'tuxedo', enabled: false, animations: false })
  })
})
