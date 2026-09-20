import type { ReviewEntry } from './scheduler'

export const PETS = [
  { id: 'mole', name: '敲敲鼹', intro: '抱着小木槌，陪你认真敲字。', idle: '慢慢来，我陪你。', typing: '一起敲敲。', cheer: '好耶，又完成一句！' },
  { id: 'sparrow', name: '米米雀', intro: '把键帽当小窝的困困文鸟。', idle: '啾，我在这里。', typing: '啾，认真模式。', cheer: '啾！为你扑扑翅膀。' },
  { id: 'sprout', name: '芽芽团', intro: '软乎乎的小团子，和你一起长大。', idle: '今天也长大一点点。', typing: '一点一点，敲出进步。', cheer: '开心得弹起来啦！' },
] as const
export type PetId = typeof PETS[number]['id']
export type PetPose = 'idle' | 'typing' | 'cheer'
export const PET_PREFERENCE_KEY = 'qiaoqiao.companion.v1'
export interface CompanionPreferences { petId: PetId; enabled: boolean; animations: boolean }
export const DEFAULT_COMPANION: CompanionPreferences = { petId: 'mole', enabled: true, animations: true }
export function isPetId(value: unknown): value is PetId { return PETS.some((pet) => pet.id === value) }
export function companionPreferences(value: string): CompanionPreferences {
  try {
    const data = JSON.parse(value)
    return { petId: isPetId(data?.petId) ? data.petId : 'mole', enabled: data?.enabled !== false, animations: data?.animations !== false }
  } catch { return { ...DEFAULT_COMPANION } }
}
export function petGrowth(reviews: ReviewEntry[]): Record<PetId, number> {
  const counts: Record<PetId, number> = { mole: 0, sparrow: 0, sprout: 0 }
  const seen = new Set<string>()
  for (const review of reviews) {
    if (seen.has(review.id)) continue
    seen.add(review.id)
    if (isPetId(review.petId)) counts[review.petId]++
  }
  return counts
}
export function growthStage(points: number) {
  const stage = points >= 150 ? 3 : points >= 30 ? 2 : 1
  const base = stage === 3 ? 150 : stage === 2 ? 30 : 0
  const next = stage === 3 ? null : stage === 2 ? 150 : 30
  return { stage, name: ['初见', '默契', '知己'][stage - 1]!, next,
    remaining: next === null ? 0 : next - points,
    percent: next === null ? 100 : Math.max(0, Math.min(100, (points - base) / (next - base) * 100)) }
}
