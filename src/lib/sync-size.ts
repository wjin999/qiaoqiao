// Mirrors supabase/migrations: each record is limited by octet_length(value::text) <= 16 KiB,
// each batch by octet_length(changes::text) <= 12 MiB. The batch budget keeps 1 MiB of headroom.
export const SYNC_LIMITS = { batchRecords: 100, batchBytes: 11 * 1024 * 1024, recordBytes: 16 * 1024 }

// PostgreSQL prints jsonb with ", " and ": " separators, so for JSON.stringify output the server
// counts its UTF-8 length plus one byte per separator outside string literals.
export function jsonbTextBytes(json: string): number {
  let bytes = 0, inString = false, escaped = false
  for (let index = 0; index < json.length; index++) {
    const code = json.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code < 0xdc00) { bytes += 4; index++; continue }
    else bytes += 3
    if (inString) {
      if (escaped) escaped = false
      else if (code === 0x5c) escaped = true
      else if (code === 0x22) inString = false
    } else if (code === 0x22) inString = true
    else if (code === 0x2c || code === 0x3a) bytes += 1
  }
  return bytes
}
