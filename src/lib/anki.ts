import { unzipSync } from 'fflate'
import { Decompress } from 'fzstd'
import type { Database, SqlJsStatic } from 'sql.js'
import type { Lesson, LessonItem } from '../types'
import { parseFurigana, plainText } from './anki-text'

export const EGG_ROLLS_ID = 'eggrolls-jlpt-v3.5'
export const MAX_APKG_SIZE = 512 * 1024 * 1024
const MAX_DATABASE_SIZE = 64 * 1024 * 1024

export interface FieldMapping {
  sentence: number
  translation: number
  furigana: number
  kind?: number
}
export interface AnkiModel { id: string; name: string; fields: string[]; noteCount: number }
export type FieldMappings = Record<string, FieldMapping[]>
interface AnkiNote { id: string; guid: string; modelId: string; fields: string[]; tags: string; deck: string }
export interface AnkiInfo {
  id: string
  title: string
  description: string
  fileName: string
  models: AnkiModel[]
  noteCount: number
  cardCount: number
  eggRolls: boolean
}
export interface AnkiPackage { info: AnkiInfo; notes: AnkiNote[] }

function rows(db: Database, query: string): Record<string, unknown>[] {
  const result = db.exec(query)[0]
  return result ? result.values.map((values) => Object.fromEntries(
    result.columns.map((column, index) => [column, values[index]]),
  )) : []
}

function decompressDatabase(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let length = 0
  const stream = new Decompress((chunk) => {
    length += chunk.length
    if (length > MAX_DATABASE_SIZE) throw new Error('卡组数据库超过 64 MB，请在 Anki 中拆分后导入。')
    chunks.push(chunk.slice())
  })
  stream.push(bytes, true)
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

export async function readApkg(bytes: Uint8Array, fileName: string, SQL: SqlJsStatic): Promise<AnkiPackage> {
  if (bytes.length > MAX_APKG_SIZE) throw new Error('文件超过 512 MB，请在 Anki 中拆分卡组后导入。')
  let archive: Record<string, Uint8Array>
  try {
    archive = unzipSync(bytes, { filter: (entry) => {
      if (!/^collection\.anki(?:2|21|21b)$/.test(entry.name)) return false
      if (entry.originalSize > MAX_DATABASE_SIZE) throw new Error('卡组数据库超过 64 MB。')
      return true
    } })
  } catch {
    throw new Error('无法打开 APKG 文件：文件可能损坏，或数据库超过 64 MB。')
  }
  // Modern archives contain a dummy .anki2. Always prefer the real collection.
  const compressed = archive['collection.anki21b']
  const database = compressed ? decompressDatabase(compressed) :
    archive['collection.anki21'] ?? archive['collection.anki2']
  if (!database || new TextDecoder().decode(database.subarray(0, 15)) !== 'SQLite format 3') {
    throw new Error('没有找到有效的 Anki 数据库，请选择从 Anki 导出的 .apkg 文件。')
  }
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(database).buffer)
  const fingerprint = Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, '0')).join('').slice(0, 24)
  let db: Database | undefined
  try {
    db = new SQL.Database(database)
    db.run('PRAGMA query_only = ON')
    const tables = new Set(rows(db, "SELECT name FROM sqlite_master WHERE type='table'").map((row) => row.name))
    if (!tables.has('notes') || !tables.has('cards')) throw new Error('缺少笔记或卡片数据。')
    const col = tables.has('col') ? rows(db, 'SELECT models, decks FROM col')[0] : undefined
    const oldModels = JSON.parse(String(col?.models ?? '{}')) as Record<string, { name: string; flds: { name: string; ord: number }[] }>
    const oldDecks = JSON.parse(String(col?.decks ?? '{}')) as Record<string, { name: string; desc?: string }>
    const models: AnkiModel[] = tables.has('notetypes')
      ? rows(db, 'SELECT id, name FROM notetypes').map((model) => ({
        id: String(model.id), name: String(model.name), noteCount: 0,
        fields: rows(db!, `SELECT name FROM fields WHERE ntid = ${Number(model.id)} ORDER BY ord`).map((field) => String(field.name)),
      }))
      : Object.entries(oldModels).map(([id, model]) => ({
        id, name: model.name, fields: [...model.flds].sort((a, b) => a.ord - b.ord).map((field) => field.name), noteCount: 0,
      }))
    const deckNames = tables.has('decks')
      ? Object.fromEntries(rows(db, 'SELECT id, name FROM decks').map((deck) => [String(deck.id), String(deck.name).replace(/\x1f/g, '::')]))
      : Object.fromEntries(Object.entries(oldDecks).map(([id, deck]) => [id, deck.name]))
    const cardCount = Number(rows(db, 'SELECT COUNT(*) AS count FROM cards')[0]?.count ?? 0)
    const noteDecks = new Map(rows(db, 'SELECT nid, MIN(CASE WHEN odid != 0 THEN odid ELSE did END) AS did FROM cards GROUP BY nid')
      .map((card) => [String(card.nid), deckNames[String(card.did)] ?? '']))
    const records = rows(db, 'SELECT id, guid, mid, flds, tags FROM notes ORDER BY id LIMIT 100001')
    if (records.length > 100000) throw new Error('卡组超过 10 万条笔记，请拆分后导入。')
    const notes = records.map((note) => ({
      id: String(note.id), guid: String(note.guid), modelId: String(note.mid),
      fields: String(note.flds).split('\x1f'), tags: String(note.tags), deck: noteDecks.get(String(note.id)) ?? '',
    }))
    for (const model of models) model.noteCount = notes.filter((note) => note.modelId === model.id).length
    const eggRolls = models.some((model) => /eggrolls.*v3\.5/i.test(model.name) && model.fields.includes('SentDefSC1'))
    const titles = [...new Set(notes.map((note) => note.deck).filter(Boolean))]
    const common = titles[0]?.split('::') ?? []
    while (common.length && !titles.every((name) => name === common.join('::') || name.startsWith(common.join('::') + '::'))) common.pop()
    return { info: {
      id: eggRolls ? EGG_ROLLS_ID : `anki-${fingerprint}`, eggRolls,
      title: eggRolls ? 'egg rolls · JLPT N1–N5' : common.join(' / ') || fileName.replace(/\.apkg$/i, ''),
      description: [...new Set(Object.values(oldDecks).map((deck) => plainText(deck.desc ?? '')).filter(Boolean))].join('\n\n'),
      fileName, models: models.filter((model) => model.noteCount > 0), noteCount: notes.length, cardCount,
    }, notes }
  } catch (error) {
    throw new Error(`无法读取卡组：${error instanceof Error ? error.message : '数据库格式不受支持。'} 可尝试在 Anki 导出时启用“支持旧版本”。`)
  } finally { db?.close() }
}

export function suggestMappings(info: AnkiInfo): FieldMappings {
  return Object.fromEntries(info.models.map((model) => {
    const fields = model.fields
    const eggSlots = [1, 2, 3, 4].filter((slot) => fields.includes(`SentKanji${slot}`)).map((slot) => ({
      sentence: fields.indexOf(`SentKanji${slot}`), translation: fields.indexOf(`SentDefSC${slot}`),
      furigana: fields.indexOf(`SentFurigana${slot}`), kind: fields.indexOf(`SentType${slot}`),
    }))
    const find = (names: string[]) => fields.findIndex((field) => names.includes(field.toLowerCase().replace(/[\s_-]/g, '')))
    return [model.id, eggSlots.length ? eggSlots : [{
      sentence: find(['sentence', 'expression', 'japanese', '例句', '日语例句', '日语', '例文', '例文日本語', 'sentkanji', 'front']),
      translation: find(['sentencetranslation', 'sentencemeaning', 'translation', 'meaning', 'chinese', '中文翻译', '例句翻译', '中文', '释义', 'sentdefsc', 'back']),
      furigana: find(['sentencefurigana', 'furigana', 'sentfurigana', '注音', '例句注音']),
    }]]
  }))
}

export function convertAnki(pkg: AnkiPackage, mappings: FieldMappings): Lesson {
  const items: LessonItem[] = []
  const seen = new Set<string>()
  let relatedCount = 0, duplicateCount = 0, missingCount = 0, unalignedReadingCount = 0
  const models = new Map(pkg.info.models.map((model) => [model.id, model]))
  for (const note of pkg.notes) {
    const model = models.get(note.modelId)
    const wordIndex = model?.fields.indexOf('VocabKanji') ?? -1
    const level = (note.tags + ' ' + note.deck).match(/N[1-5]/)?.[0]
    for (const mapping of mappings[note.modelId] ?? []) {
      const source = note.fields[mapping.sentence] ?? ''
      if (!source.trim()) continue
      const kind = mapping.kind === undefined ? '' : plainText(note.fields[mapping.kind] ?? '')
      if (/[関關对対]/.test(kind)) { relatedCount += 1; continue }
      const text = plainText(source)
      const nativeText = plainText(note.fields[mapping.translation] ?? '')
      if (!text || !nativeText || text.length > 1000 || nativeText.length > 2000) { missingCount += 1; continue }
      const key = `${text}\x1f${nativeText}`
      if (seen.has(key)) { duplicateCount += 1; continue }
      seen.add(key)
      const { ruby, aligned } = parseFurigana(text, note.fields[mapping.furigana] ?? '')
      if (!aligned) unalignedReadingCount += 1
      items.push({
        id: `${pkg.info.id}:${encodeURIComponent(note.guid || note.id)}:${mapping.sentence}`,
        text, nativeText, ruby, ...(level ? { level } : {}),
        ...(wordIndex >= 0 ? { sourceWord: plainText(note.fields[wordIndex] ?? '') } : {}),
        sourceNoteId: note.guid || note.id,
      })
    }
  }
  return {
    schemaVersion: 2, id: pkg.info.id, title: pkg.info.title, nativeLanguage: 'zh-CN', targetLanguage: 'ja', items,
    metadata: {
      description: pkg.info.eggRolls
        ? 'egg rolls 制作的 JLPT N1–N5 日语学习卡组。本练习库提取其中的日语例句与短语，配有简体中文翻译和原卡组假名注音。'
        : pkg.info.description || '从 Anki 卡组导入的日语跟打练习。',
      ...(pkg.info.eggRolls ? {
        author: 'egg rolls', version: 'v3.5 · NO ENGLISH', sourceUrl: 'https://github.com/5mdld/anki-jlpt-decks',
        license: 'CC BY-NC 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans',
        licenseTerms: [
          '署名：注明原作者 egg rolls，提供原卡组发布链接，并说明是否修改过内容。',
          '非商业性使用：不得出售卡组、整合进付费产品或服务，或用于商业广告与市场推广。',
          '无附加限制：不得施加额外法律条款或技术措施，限制他人行使许可允许的权利。',
        ],
      } : {}),
      modifications: '已转换为日语敲敲跟打格式；保留原句、中文翻译与可对齐的注音；排除关联词、反义词、缺少翻译的条目，并按日中句对去重。音频、图片、卡片模板和 Anki 复习进度未导入。',
      sourceFile: pkg.info.fileName, noteCount: pkg.info.noteCount, cardCount: pkg.info.cardCount,
      relatedCount, duplicateCount, missingCount, unalignedReadingCount,
    },
  }
}
