import type { LessonItem } from '../types'

// The sentence to type, with each character marked pending, correct or incorrect,
// and readings (furigana) shown above their characters when requested.
export function TargetSentence({ item, typed, showReadings }: { item: LessonItem; typed: string; showReadings: boolean }) {
  // Compare by code point so characters outside the BMP (e.g. 𠮟) are never split in two.
  const entered = Array.from(typed)
  let offset = 0
  return item.ruby.map((part, partIndex) => {
    const characters = Array.from(part.text)
    const startIndex = offset
    offset += characters.length
    const base = characters.map((character, characterIndex) => {
      const index = startIndex + characterIndex
      const enteredCharacter = entered[index]
      const state = enteredCharacter === undefined ? 'pending' : enteredCharacter === character ? 'correct' : 'incorrect'
      return <span className={`character character--${state}`} key={index}>{character}</span>
    })
    if (showReadings && part.reading) return <ruby className="ruby-group" key={partIndex}>{base}<rt>{part.reading}</rt></ruby>
    return <span className="ruby-group" key={partIndex}>{base}</span>
  })
}
