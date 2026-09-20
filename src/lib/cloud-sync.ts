import { acknowledgeChanges, applyCloudRows, cloudCursor, pendingChanges, validHistoryEntry } from './storage'
import { getAccountScope } from './account-scope'
import { publishableKey, supabaseUrl } from './supabase'
import { validCard, validReview } from './progress-backup'
import { isPreference } from './preferences'
import type { CloudMutation, CloudRow } from './cloud-types'
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

export function validCloudRow(row: CloudRow): boolean {
  if (!row || typeof row.key !== 'string' || !Number.isSafeInteger(row.version) || row.version < 1) return false
  if (row.kind === 'skip') return typeof row.value === 'boolean'
  if (row.kind === 'setting') return isPreference(row.key) && typeof row.value === 'string'
  if (!row.value || (row.value as { id?: string }).id !== row.key) return false
  if (row.kind === 'review') return validReview(row.value)
  if (row.kind === 'history') return validHistoryEntry(row.value)
  if (row.kind === 'seed') return validCard(row.value)
  return row.kind === 'deck' && validDeck(row.value)
}

export interface SyncTransport {
  push: (changes: CloudMutation[]) => Promise<void>
  pull: (cursor: number) => Promise<CloudRow[]>
}
export function cloudTransport(accessToken: string): SyncTransport {
  async function rpc(name: string, body: unknown) {
    // Capture this session's token. Switching accounts mid-request must never
    // upload the old account's outbox using the new account's credentials.
    const response = await fetch(`${supabaseUrl}/rest/v1/${name}`, {
      method: 'POST', headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { message?: string }
      throw new Error(error.message || `sync_http_${response.status}`)
    }
    return response.status === 204 ? null : response.json()
  }
  return {
    push: async (changes) => { await rpc('rpc/qiaoqiao_push', { changes }) },
    pull: (cursor) => rpc('rpc/qiaoqiao_pull', { after_version: cursor }),
  }
}

export async function syncAccount(account: string, transport: SyncTransport): Promise<void> {
  const run = async () => {
    const active = () => account === getAccountScope()
    if (!active()) return
    const pending = await pendingChanges(account)
    let batch: CloudMutation[] = []; let bytes = 0
    async function send() {
      if (!batch.length || !active()) return
      await transport.push(batch)
      await acknowledgeChanges(account, batch)
      batch = []; bytes = 0
    }
    for (const entry of pending) {
      if (!active()) return
      const size = new TextEncoder().encode(JSON.stringify(entry)).length
      if (size > 11 * 1024 * 1024) throw new Error('sync_record_too_large')
      if (batch.length >= 100 || bytes + size > 11 * 1024 * 1024) await send()
      batch.push(entry); bytes += size
    }
    await send()
    let cursor = await cloudCursor(account)
    while (active()) {
      const rows = await transport.pull(cursor)
      if (!active()) return
      if (!Array.isArray(rows) || !rows.every(validCloudRow)) throw new Error('云端记录格式不兼容，请更新网页后重试。')
      if (!rows.length) break
      if (rows.some((row, index) => row.version <= (index ? rows[index - 1]!.version : cursor))) throw new Error('云端同步顺序无效，请重试。')
      cursor = rows[rows.length - 1]!.version
      await applyCloudRows(account, rows, cursor)
      if (rows.length < 100) break
    }
  }
  // Serialize complete upload/pull cycles across tabs, as well as within the UI.
  if (navigator.locks) await navigator.locks.request(`qiaoqiao-sync:${account}`, run)
  else await run()
}
