import { useMemo } from 'react'
import { phraseStarts } from '../lib/line-breaks'
import type { LessonItem, TargetLanguage } from '../types'

// The sentence to type, with each character marked pending, composing (IME not confirmed yet), correct or
// incorrect, and readings (furigana) shown above their characters when requested.
// Japanese lines break only between phrases: the sentence uses word-break: keep-all and gets a <wbr> at each
// phrase start that does not fall inside a reading group.
export function TargetSentence({ item, typed, showReadings, composingFrom = null, language = 'ja' }: {
  item: LessonItem; typed: string; showReadings: boolean
  // Characters typed from here on are still being converted by the IME: shown as in progress, not judged.
  composingFrom?: number | null; language?: TargetLanguage
}) {
  const breaks = useMemo(() => language === 'ja' ? phraseStarts(item.text) : new Set<number>(), [item.text, language])
  // Compare by code point so characters outside the BMP (e.g. 𠮟) are never split in two.
  const entered = Array.from(typed)
  let offset = 0
  return item.ruby.flatMap((part, partIndex) => {
    const characters = Array.from(part.text)
    const startIndex = offset
    offset += characters.length
    const base = characters.flatMap((character, characterIndex) => {
      const index = startIndex + characterIndex
      const enteredCharacter = entered[index]
      const state = enteredCharacter === undefined ? 'pending' : composingFrom !== null && index >= composingFrom ? 'composing'
        : enteredCharacter === character ? 'correct' : 'incorrect'
      const span = <span className={`character character--${state}`} key={index}>{character}</span>
      // Inside a reading group the base stays whole; elsewhere a phrase may start mid-part.
      return !part.reading && characterIndex > 0 && breaks.has(index) ? [<wbr key={`b${index}`} />, span] : [span]
    })
    const group = showReadings && part.reading
      ? <ruby className="ruby-group" key={partIndex}>{base}<rt>{part.reading}</rt></ruby>
      : <span className="ruby-group" key={partIndex}>{base}</span>
    return breaks.has(startIndex) ? [<wbr key={`b${startIndex}`} />, group] : [group]
  })
}
