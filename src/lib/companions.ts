import type { ReviewEntry } from './scheduler'

export const PETS = [
  { id: 'golden', name: '麦麦', intro: '温暖的大金毛，认真陪你敲每一句。', idle: '慢慢来，我陪你。', typing: '一起认真敲敲。', cheer: '做得好，击个掌！' },
  { id: 'tuxedo', name: '点点', intro: '机灵的黑白猫，轻轻伸爪为你加油。', idle: '喵，我在这里。', typing: '这句，我也会喵。', cheer: '喵，给你一个爪爪！' },
] as const
export type ActivePetId = typeof PETS[number]['id']
// Retired IDs remain valid in old backups and synced learning records.
export type PetId = ActivePetId | 'mole' | 'sparrow' | 'sprout'
export type PetPose = 'idle' | 'typing' | 'cheer'
export const PET_PREFERENCE_KEY = 'qiaoqiao.companion.v1'
export type OutfitId = 'natural' | 'bomber' | 'explorer' | 'varsity' | 'space'
export const OUTFITS = {
  golden: [{ id: 'natural', name: '原始造型', points: 0 }, { id: 'bomber', name: '飞行夹克', points: 30 }, { id: 'explorer', name: '森林探险服', points: 150 }],
  tuxedo: [{ id: 'natural', name: '原始造型', points: 0 }, { id: 'varsity', name: '校园棒球外套', points: 30 }, { id: 'space', name: '星际宇航服', points: 150 }],
} as const
export interface CompanionPreferences { petId: ActivePetId; enabled: boolean; animations: boolean; outfits?: Partial<Record<ActivePetId, OutfitId>> }
export function validOutfit(pet: ActivePetId, value: unknown): OutfitId {
  return OUTFITS[pet].find((item) => item.id === value)?.id ?? 'natural'
}
export function equippedOutfit(preferences: CompanionPreferences, pet: ActivePetId, points: number): OutfitId {
  const item = OUTFITS[pet].find((entry) => entry.id === preferences.outfits?.[pet])
  return item && points >= item.points ? item.id : 'natural'
}
export const DEFAULT_COMPANION: CompanionPreferences = { petId: 'golden', enabled: true, animations: true }
export function isActivePetId(value: unknown): value is ActivePetId { return PETS.some((pet) => pet.id === value) }
export function isPetId(value: unknown): value is PetId { return isActivePetId(value) || value === 'mole' || value === 'sparrow' || value === 'sprout' }
export function companionPreferences(value: string): CompanionPreferences {
  try {
    const data = JSON.parse(value)
    return { petId: isActivePetId(data?.petId) ? data.petId : 'golden', enabled: data?.enabled !== false, animations: data?.animations !== false,
      ...(data?.outfits && typeof data.outfits === 'object' ? { outfits: { golden: validOutfit('golden', data.outfits.golden), tuxedo: validOutfit('tuxedo', data.outfits.tuxedo) } } : {}) }
  } catch { return { ...DEFAULT_COMPANION } }
}
export function petGrowth(reviews: ReviewEntry[]): Record<ActivePetId, number> {
  const counts: Record<ActivePetId, number> = { golden: 0, tuxedo: 0 }
  const seen = new Set<string>()
  for (const review of reviews) {
    if (seen.has(review.id)) continue
    seen.add(review.id)
    if (isActivePetId(review.petId)) counts[review.petId]++
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
