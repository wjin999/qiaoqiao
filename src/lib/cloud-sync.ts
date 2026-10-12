import { acknowledgeChanges, announceProgressUpdate, applyCloudRows, cloudCursor, loadQuarantine, pendingChanges, validHistoryEntry } from './storage'
import { getAccountScope } from './account-scope'
import { publishableKey, supabaseUrl } from './supabase'
import { validCard, validReview } from './progress-backup'
import { isPreference, isRetiredPreference } from './preferences'
import { isDeckTombstone, type CloudChanges, type CloudMutation, type CloudRow, type PushResult, type RejectedChange } from './cloud-types'
import { jsonbTextBytes, recordLimit, SYNC_LIMITS } from './sync-size'
import type { Lesson } from '../types'

export function validDeck(value: unknown): value is Lesson {
  if (!value || typeof value !== 'object') return false
  const deck = value as Lesson
  const metadata = deck.metadata
  const metadataValid = metadata === undefined || (!!metadata && typeof metadata === 'object'
    && typeof metadata.description === 'string'
    && ['author', 'version', 'sourceUrl', 'license', 'licenseUrl', 'modifications', 'sourceFile'].every((key) => {
      const field = (metadata as unknown as Record<string, unknown>)[key]
      return field === undefined || typeof field === 'string'
    })
    && ['noteCount', 'cardCount', 'relatedCount', 'duplicateCount', 'missingCount', 'unalignedReadingCount'].every((key) => {
      const field = (metadata as unknown as Record<string, unknown>)[key]
      return typeof field === 'number' && Number.isSafeInteger(field) && field >= 0
    })
    && (metadata.licenseTerms === undefined || (Array.isArray(metadata.licenseTerms) && metadata.licenseTerms.every((term) => typeof term === 'string'))))
  return deck.schemaVersion === 2 && typeof deck.id === 'string' && typeof deck.title === 'string'
    && deck.nativeLanguage === 'zh-CN' && deck.targetLanguage === 'ja' && Array.isArray(deck.items)
    && deck.items.length > 0 && deck.items.length <= 100000
    && deck.items.every((item) => item && typeof item.id === 'string' && typeof item.text === 'string'
      && typeof item.nativeText === 'string' && (item.level === undefined || typeof item.level === 'string')
      && Array.isArray(item.ruby) && item.ruby.every((part) => part && typeof part.text === 'string'
        && (part.reading === undefined || typeof part.reading === 'string')))
    && metadataValid
}

// The cursor depends on these fields; a row that has them but is otherwise unreadable
// (e.g. written by a newer version) is quarantined instead of blocking the sync.
function validEnvelope(row: CloudRow): boolean {
  return !!row && typeof row.kind === 'string' && typeof row.key === 'string' && Number.isSafeInteger(row.version) && row.version >= 1
}

export function validCloudRow(row: CloudRow): boolean {
  if (!validEnvelope(row)) return false
  if (row.kind === 'skip') return typeof row.value === 'boolean'
  if (row.kind === 'setting') return (isPreference(row.key) || isRetiredPreference(row.key)) && typeof row.value === 'string'
  if (!row.value || (row.value as { id?: string }).id !== row.key) return false
  if (row.kind === 'review') return validReview(row.value)
  if (row.kind === 'history') return validHistoryEntry(row.value)
  if (row.kind === 'seed') return validCard(row.value)
  return row.kind === 'deck' && (isDeckTombstone(row.value) || validDeck(row.value))
}

export interface SyncTransport {
  // Per-change results, or nothing when the server only accepts all-or-nothing batches.
  push: (changes: CloudMutation[]) => Promise<PushResult[] | void>
  pull: (cursor: number) => Promise<CloudRow[]>
}
class SyncRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message) }
}
export function cloudTransport(accessToken: string): SyncTransport {
  let legacyPush = false
  async function rpc(name: string, body: unknown) {
    // Capture this session's token. Switching accounts mid-request must never
    // upload the old account's outbox using the new account's credentials.
    const response = await fetch(`${supabaseUrl}/rest/v1/${name}`, {
      method: 'POST', headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { message?: string; code?: string }
      throw new SyncRequestError(error.message || `sync_http_${response.status}`, response.status, error.code)
    }
    return response.status === 204 ? null : response.json()
  }
  return {
    push: async (changes) => {
      if (!legacyPush) {
        try { return await rpc('rpc/qiaoqiao_push_v2', { changes }) as PushResult[] }
        catch (error) {
          // Until the database is migrated, fall back to all-or-nothing batches.
          if (!(error instanceof SyncRequestError && (error.code === 'PGRST202' || error.status === 404))) throw error
          legacyPush = true
        }
      }
      await rpc('rpc/qiaoqiao_push', { changes })
    },
    pull: (cursor) => rpc('rpc/qiaoqiao_pull', { after_version: cursor }),
  }
}

export interface SyncReport {
  changed: CloudChanges
  // Changes kept queued for a later sync, changes the server will never accept, and pulled rows this version cannot read.
  retry: number
  rejected: number
  quarantined: number
  reasons: string[]
}

export function syncNotice(report: SyncReport): string {
  const notes: string[] = []
  if (report.retry) {
    notes.push(report.reasons.includes('device_clock_ahead') ? `${report.retry} 条记录的时间晚于服务器，稍后自动上传`
      : report.reasons.includes('account_sync_quota_exceeded') ? `云端容量已满，${report.retry} 条记录暂存本机`
        : `${report.retry} 条记录稍后上传`)
  }
  if (report.rejected) notes.push(`${report.rejected} 条记录超出云端限制，仅保存在本机`)
  if (report.quarantined) notes.push(`${report.quarantined} 条云端记录需刷新网页后读取`)
  return notes.length ? `（${notes.join('；')}）` : ''
}

export async function syncAccount(account: string, transport: SyncTransport): Promise<SyncReport> {
  const report: SyncReport = { changed: { progress: false, settings: false, decks: false }, retry: 0, rejected: 0, quarantined: 0, reasons: [] }
  const active = () => account === getAccountScope()
  const note = (reason: string) => { if (!report.reasons.includes(reason)) report.reasons.push(reason) }
  const merge = (changed: CloudChanges) => {
    report.changed = { progress: report.changed.progress || changed.progress,
      settings: report.changed.settings || changed.settings, decks: report.changed.decks || changed.decks }
  }

  async function push() {
    const pending = await pendingChanges(account)
    const tooLarge: RejectedChange[] = []
    let batch: CloudMutation[] = []; let bytes = 2
    async function send() {
      if (!batch.length || !active()) return
      const sent = batch; batch = []; bytes = 2
      const results = await transport.push(sent)
      const accepted: CloudMutation[] = [], rejected: RejectedChange[] = []
      sent.forEach((change, index) => {
        const result: PushResult | undefined = results ? results[index] : { mutationId: change.mutationId, status: 'ok' }
        if (!result || result.mutationId !== change.mutationId) throw new Error('sync_response_mismatch')
        if (result.status === 'ok') accepted.push(change)
        else if (result.status === 'rejected') { rejected.push({ change, error: result.error || 'invalid_sync_record' }); note(result.error || 'invalid_sync_record') }
        else { report.retry += 1; note(result.error || 'retry') }
      })
      report.rejected += rejected.length
      await acknowledgeChanges(account, accepted, rejected)
    }
    for (const change of pending) {
      if (!active()) return
      // Measure the way the server does, and never send what it cannot store.
      if (jsonbTextBytes(JSON.stringify(change.value)) > recordLimit(change.kind)) {
        tooLarge.push({ change, error: 'sync_record_too_large' }); continue
      }
      const size = jsonbTextBytes(JSON.stringify(change)) + 2
      if (batch.length >= SYNC_LIMITS.batchRecords || (batch.length && bytes + size > SYNC_LIMITS.batchBytes)) await send()
      batch.push(change); bytes += size
    }
    await send()
    if (tooLarge.length && active()) {
      await acknowledgeChanges(account, [], tooLarge)
      report.rejected += tooLarge.length; note('sync_record_too_large')
    }
  }

  async function pull() {
    let cursor = await cloudCursor(account)
    while (active()) {
      const rows = await transport.pull(cursor)
      if (!active()) return
      if (!Array.isArray(rows) || !rows.every(validEnvelope)) throw new Error('云端记录格式不兼容，请更新网页后重试。')
      if (!rows.length) break
      if (rows.some((row, index) => row.version <= (index ? rows[index - 1]!.version : cursor))) throw new Error('云端同步顺序无效，请重试。')
      cursor = rows[rows.length - 1]!.version
      // Settings of retired features are accepted and ignored.
      merge(await applyCloudRows(account, rows.filter((row) => !(row.kind === 'setting' && isRetiredPreference(row.key))), cursor, validCloudRow))
      if (rows.length < 100) break
    }
    // Rows an earlier version of this page could not read may be readable now.
    const held = await loadQuarantine(account)
    const readable = held.filter(validCloudRow)
    if (readable.length && active()) merge(await applyCloudRows(account, readable, null, validCloudRow))
    report.quarantined = held.length - readable.length
  }

  const run = async () => {
    if (!active()) return report
    try {
      // A failed upload (e.g. one rejected batch) must not stop this device from receiving updates.
      let pushError: unknown
      try { await push() } catch (error) { pushError = error }
      if (!active()) return report
      await pull()
      if (pushError) throw pushError
      return report
    } finally {
      if (report.changed.progress || report.changed.settings || report.changed.decks) announceProgressUpdate()
    }
  }
  // Serialize complete upload/pull cycles across tabs, as well as within the UI.
  if (navigator.locks) return navigator.locks.request(`qiaoqiao-sync:${account}`, run)
  return run()
}
