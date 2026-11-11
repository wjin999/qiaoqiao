import { expect, it } from 'vitest'
import { phraseStarts } from './line-breaks'

// The text with " | " at every place a line may break.
function phrases(text: string) {
  const starts = phraseStarts(text)
  return Array.from(text).map((character, index) => (starts.has(index) ? ' | ' : '') + character).join('')
}

it('breaks between phrases (文節), not inside words', () => {
  expect(phrases('黒い油でべっとりした換気扇は汚くて掃除しにくい')).toBe('黒い油で | べっとりした | 換気扇は | 汚くて | 掃除しにくい')
  expect(phrases('妹は高校に通っています')).toBe('妹は | 高校に | 通っています')
  // Phrase guesses that would cut a dictionary word are dropped.
  expect(phrases('午後になるとなおさらひどくなった')).not.toContain('な | おさら')
  expect(phrases('彼女はいつもにこにこしています')).not.toMatch(/に \| こ/)
})

it('counts offsets in code points, as typing does', () => {
  // 𠮟 is two UTF-16 units; the break before 子 must still land on 子.
  const text = '𠮟られた子どもは泣いた'
  expect([...phraseStarts(text)].map((start) => Array.from(text)[start])).toContain('子')
})
