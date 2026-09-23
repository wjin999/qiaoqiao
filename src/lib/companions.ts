// Keep accepting metadata written by the retired companion release so old
// backups and devices can still sync their learning records.
export type PetId = 'mole' | 'sparrow' | 'sprout'
export const PET_PREFERENCE_KEY = 'qiaoqiao.companion.v1'
export function isPetId(value: unknown): value is PetId {
  return value === 'mole' || value === 'sparrow' || value === 'sprout'
}
