// Only learning records are synced; decks and settings stay on each device.
export type CloudKind = 'review' | 'history' | 'seed' | 'skip'
export const SYNCED_KINDS: ReadonlySet<string> = new Set<CloudKind>(['review', 'history', 'seed', 'skip'])
// Synced by earlier versions; ignored wherever they still turn up (queues, older cloud rows).
export const RETIRED_KINDS: ReadonlySet<string> = new Set(['setting', 'deck'])
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
// "retry": keep the change queued (device clock ahead, quota full).
// "rejected": the server can never store it, so it must not block the queue.
export interface PushResult { mutationId: string; status: 'ok' | 'retry' | 'rejected'; error?: string | null }
export interface RejectedChange { change: CloudMutation; error: string }
export const cloudKey = (kind: CloudKind, key: string) => JSON.stringify([kind, key])
