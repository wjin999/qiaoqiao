import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { zipSync, strToU8 } from 'fflate'
import { zstdCompressSync } from 'node:zlib'
import { convertAnki, readApkg, suggestMappings } from './anki'
import { parseFurigana, plainText } from './anki-text'

let SQL: SqlJsStatic
beforeAll(async () => { SQL = await initSqlJs() })

function collection(modern = false) {
  const db = new SQL.Database()
  db.run(`CREATE TABLE col (models TEXT, decks TEXT);
    CREATE TABLE notes (id INTEGER, guid TEXT, mid INTEGER, flds TEXT, tags TEXT);
    CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER, odid INTEGER);`)
  const fields = ['日语例句', '中文翻译', '注音']
  if (modern) {
    db.run('CREATE TABLE notetypes (id INTEGER, name TEXT); CREATE TABLE fields (ntid INTEGER, ord INTEGER, name TEXT); CREATE TABLE decks (id INTEGER, name TEXT);')
    db.run("INSERT INTO notetypes VALUES (1, '日语学习'); INSERT INTO decks VALUES (10, '日语::N5'); INSERT INTO col VALUES ('', '');")
    fields.forEach((name, index) => db.run('INSERT INTO fields VALUES (1, ?, ?)', [index, name]))
  } else {
    db.run('INSERT INTO col VALUES (?, ?)', [
      JSON.stringify({ 1: { name: '日语学习', flds: fields.map((name, ord) => ({ name, ord })) } }),
      JSON.stringify({ 10: { name: '日语::N5', desc: '<p>我的日语例句</p><script>bad()</script>' } }),
    ])
  }
  db.run('INSERT INTO notes VALUES (1, ?, 1, ?, ?)', ['note-guid', '妹は高校に通っています\x1f妹妹在上高中\x1f妹[いもうと]は<b> 高校[こうこう]</b>に 通[かよ]っています', ' N5 '])
  db.run('INSERT INTO cards VALUES (1,1,10,0), (2,1,10,0)')
  const data = db.export()
  db.close()
  return data
}

describe('Anki package import', () => {
  it('reads a legacy APKG and creates one example per note, not per card', async () => {
    const data = zipSync({ 'collection.anki2': collection(), media: strToU8('{}') })
    const pkg = await readApkg(data, 'my-deck.apkg', SQL)
    const lesson = convertAnki(pkg, suggestMappings(pkg.info))
    expect(pkg.info.cardCount).toBe(2)
    expect(pkg.info.noteCount).toBe(1)
    expect(pkg.info.description).toBe('我的日语例句')
    expect(lesson.items).toHaveLength(1)
    expect(lesson.items[0]).toMatchObject({ text: '妹は高校に通っています', nativeText: '妹妹在上高中', level: 'N5' })
    expect(lesson.items[0]?.ruby).toContainEqual({ text: '高校', reading: 'こうこう' })
  })

  it('prefers collection.anki21 over the dummy collection.anki2', async () => {
    const pkg = await readApkg(zipSync({ 'collection.anki2': strToU8('dummy'), 'collection.anki21': collection() }), 'legacy2.apkg', SQL)
    expect(pkg.notes).toHaveLength(1)
  })

  it('reads a modern zstd archive with normalized model and field tables', async () => {
    const data = zipSync({ 'collection.anki21b': zstdCompressSync(collection(true)), 'collection.anki2': strToU8('dummy') })
    const pkg = await readApkg(data, 'modern.apkg', SQL)
    expect(pkg.info.models[0]?.fields).toEqual(['日语例句', '中文翻译', '注音'])
    expect(convertAnki(pkg, suggestMappings(pkg.info)).items).toHaveLength(1)
  })

  it('supports manual field mapping and stable ids on repeat import', async () => {
    const bytes = zipSync({ 'collection.anki2': collection() })
    const first = await readApkg(bytes, 'first-name.apkg', SQL)
    const second = await readApkg(bytes, 'renamed.apkg', SQL)
    expect(first.info.id).toBe(second.info.id)
    expect(convertAnki(first, { 1: [{ sentence: -1, translation: -1, furigana: -1 }] }).items).toHaveLength(0)
    const lesson = convertAnki(first, { 1: [{ sentence: 0, translation: 1, furigana: -1 }] })
    expect(lesson.items[0]?.ruby).toEqual([{ text: '妹は高校に通っています' }])
  })

  it('filters related words, missing translations and duplicate sentence pairs', async () => {
    const pkg = await readApkg(zipSync({ 'collection.anki2': collection() }), 'test.apkg', SQL)
    const note = pkg.notes[0]!
    pkg.notes = [note, { ...note, guid: 'duplicate' }, { ...note, guid: 'related', fields: ['学校', '学校', '', '関'] }, { ...note, guid: 'missing', fields: ['猫です', '', ''] }]
    const lesson = convertAnki(pkg, { 1: [{ sentence: 0, translation: 1, furigana: 2, kind: 3 }] })
    expect(lesson.items).toHaveLength(1)
    expect(lesson.metadata).toMatchObject({ relatedCount: 1, duplicateCount: 1, missingCount: 1 })
  })

  it('rejects malformed packages and files without an Anki database', async () => {
    await expect(readApkg(strToU8('not a zip'), 'broken.apkg', SQL)).rejects.toThrow('无法打开')
    await expect(readApkg(zipSync({ 'other.txt': strToU8('text') }), 'empty.apkg', SQL)).rejects.toThrow('没有找到')
  })
})

describe('Anki text and furigana', () => {
  it('removes active content and media while decoding entities', () => {
    expect(plainText('<script>bad()</script><style>bad</style><b>猫</b>&amp;犬<br>[sound:test.mp3]<img src="https://example.invalid/a">')).toBe('猫&犬')
  })

  it('reads HTML ruby without adding the readings to the typing target', () => {
    const source = '<ruby>学校<rp>(</rp><rt>がっこう</rt><rp>)</rp></ruby>へ行く'
    expect(plainText(source)).toBe('学校へ行く')
    expect(parseFurigana('学校へ行く', source)).toMatchObject({ aligned: true, ruby: [{ text: '学校', reading: 'がっこう' }, { text: 'へ行く' }] })
  })

  it('preserves the typing target when a reading does not match it', () => {
    expect(parseFurigana('学校へ行く', '会社[かいしゃ]へ 行[い]く')).toEqual({ ruby: [{ text: '学校へ行く' }], aligned: false })
  })
})
