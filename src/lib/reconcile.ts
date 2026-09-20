import { reviewSentence, sentenceKey, type ReviewEntry, type SentenceProgress } from './scheduler'

// Schedules are derived from immutable attempts, never chosen by last upload time.
export function rebuildCards(reviews: ReviewEntry[], seeds: SentenceProgress[]): SentenceProgress[] {
  const groups = new Map<string, ReviewEntry[]>()
  for (const entry of reviews) {
    if (entry.rating === null) continue
    const key = sentenceKey(entry.lessonId, entry.sentenceId)
    const list = groups.get(key) ?? []
    list.push(entry); groups.set(key, list)
  }
  const seedMap = new Map(seeds.map((entry) => [entry.id, entry]))
  const result: SentenceProgress[] = []
  for (const key of new Set([...groups.keys(), ...seedMap.keys()])) {
    const logs = [...new Map((groups.get(key) ?? []).map((entry) => [entry.id, entry])).values()]
      .sort((a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt) || a.id.localeCompare(b.id, 'en'))
    const seed = seedMap.get(key)
    // Older backups can contain a card without its complete review log. Keep that
    // checkpoint, rather than resetting its memory state during the first sync.
    let card = seed && logs.filter((entry) => entry.reviewedAt <= seed.updatedAt).length < seed.card.reps ? seed : undefined
    for (const entry of logs) {
      if (card === seed && seed && entry.reviewedAt <= seed.updatedAt) continue
      card = reviewSentence(card, entry.lessonId, { id: entry.sentenceId, text: '', nativeText: '', ruby: [], sourceNoteId: seed?.sourceNoteId }, entry.rating!, new Date(entry.reviewedAt))
    }
    if (card) result.push(card)
  }
  return result
}
