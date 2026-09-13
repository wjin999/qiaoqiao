import { useState } from 'react'
import type { Lesson } from '../types'
import { DeckDetails } from './DeckDetails'

interface Props {
  lessons: Lesson[]
  lesson: Lesson
  onSelect: (id: string) => void
  onImport: () => void
  level: string
  onLevel: (level: string) => void
  disabled?: boolean
}

export function DeckPicker({ lessons, lesson, onSelect, onImport, level, onLevel, disabled = false }: Props) {
  const [details, setDetails] = useState(false)
  return (
    <div className="deck-panel">
      <div className="deck-panel-heading">
        <span className="eyebrow">我的卡组</span>
        <button className="text-button" type="button" disabled={disabled} onClick={onImport}>＋ 添加 Anki 卡组</button>
      </div>
      <label className="field-label" htmlFor="deck-select">选择卡组</label>
      <select id="deck-select" disabled={disabled} value={lesson.id} onChange={(event) => onSelect(event.target.value)}>
        {lessons.map((deck) => <option key={deck.id} value={deck.id}>{deck.title}{deck.metadata?.builtIn ? ' · 默认' : ''}</option>)}
      </select>
      <div className="deck-summary">
        <span>{lesson.items.length.toLocaleString('zh-CN')} 条例句与短语</span>
        <button className="text-button" type="button" onClick={() => setDetails(true)}>卡组详情 ↗</button>
      </div>
      <label className="field-label" htmlFor="level-select">练习范围</label>
      <select id="level-select" disabled={disabled} value={level} onChange={(event) => onLevel(event.target.value)}>
        <option value="all">全部等级</option>
        {['N5', 'N4', 'N3', 'N2', 'N1'].filter((value) => lesson.items.some((item) => item.level === value))
          .map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <div className="deck-example"><p lang="ja">天気がいいから、散歩しましょう</p><span>天气很好，我们去散步吧</span></div>
      {details && <DeckDetails lesson={lesson} onClose={() => setDetails(false)} />}
    </div>
  )
}
