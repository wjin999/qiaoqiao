import { jaModel, Parser } from 'budoux'

// Japanese has no spaces, so a browser may break a line between any two characters, often inside a word
// (汚く / て). Lines should break only between phrases (文節): BudouX finds phrase starts, and a start is
// kept only where the dictionary word segmenter also starts a word, which drops BudouX's occasional
// guesses inside a word (掃除しに / くい, な / おさら).
const phrases = new Parser(jaModel)
const words = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ja', { granularity: 'word' }) : null

/** Code point offsets (as Array.from(text) counts them) where a line may break; never 0. */
export function phraseStarts(text: string): Set<number> {
  const wordStarts = words ? new Set([...words.segment(text)].map((segment) => segment.index)) : null
  const starts = new Set<number>()
  let unit = 0
  for (const phrase of phrases.parse(text)) {
    if (unit > 0 && (!wordStarts || wordStarts.has(unit))) starts.add(Array.from(text.slice(0, unit)).length)
    unit += phrase.length
  }
  return starts
}
