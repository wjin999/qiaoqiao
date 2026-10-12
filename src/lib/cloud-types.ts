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
// "retry": keep the change queued (device clock ahead, quota full, setting unknown to the database).
// "rejected": the server can never store it, so it must not block the queue.
export interface PushResult { mutationId: string; status: 'ok' | 'retry' | 'rejected'; error?: string | null }
export interface RejectedChange { change: CloudMutation; error: string }
export interface CloudChanges { progress: boolean; settings: boolean; decks: boolean }
export const cloudKey = (kind: CloudKind, key: string) => JSON.stringify([kind, key])
// Deleting a deck uploads this in place of the deck so other devices delete it too.
export const isDeckTombstone = (value: unknown): value is { id: string; deleted: true } =>
  !!value && typeof value === 'object' && (value as { deleted?: unknown }).deleted === true
