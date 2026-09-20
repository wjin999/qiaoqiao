export type CloudKind = 'review' | 'history' | 'seed' | 'skip' | 'setting' | 'deck'
export interface CloudMutation {
  id: string
  kind: CloudKind
  key: string
  value: unknown
  mutationId: string
}
export interface CloudRow {
  kind: CloudKind
  key: string
  value: unknown
  version: number
}
export const cloudKey = (kind: CloudKind, key: string) => JSON.stringify([kind, key])
