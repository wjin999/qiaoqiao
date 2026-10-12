import { useState } from 'react'
import type { Lesson } from '../types'
import { DeckDetails } from './DeckDetails'

export function DeckLoading({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <div className="deck-panel">
    <div className="deck-panel-heading"><span className="eyebrow">我的卡组</span></div>
    {error ? <p role="alert" className="error-message">{error} <button type="button" className="text-button" onClick={onRetry}>重试</button></p>
      : <p role="status" className="deck-summary">正在加载 egg rolls 例句库…</p>}
  </div>
}

interface Props {
  lesson: Lesson
  level: string
  onLevel: (level: string) => void
  disabled?: boolean
}

export function DeckPicker({ lesson, level, onLevel, disabled = false }: Props) {
  const [details, setDetails] = useState(false)
  const levels = ['N5', 'N4', 'N3', 'N2', 'N1'].filter((value) => lesson.items.some((item) => item.level === value))
  return (
    <div className="deck-panel">
      <div className="deck-panel-heading">
        <span className="eyebrow">我的卡组</span>
      </div>
      <p className="deck-title">{lesson.title}</p>
      <div className="deck-summary">
        <span>{lesson.items.length.toLocaleString('zh-CN')} 条例句与短语</span>
        <button className="text-button" type="button" onClick={() => setDetails(true)}>卡组详情 ↗</button>
      </div>
      {levels.length > 0 && <>
        <label className="field-label" htmlFor="level-select">练习范围</label>
        <select id="level-select" disabled={disabled} value={level} onChange={(event) => onLevel(event.target.value)}>
          <option value="all">全部等级</option>
          {levels.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </>}
      <div className="deck-example"><p lang="ja">天気がいいから、散歩しましょう</p><span>天气很好，我们去散步吧</span></div>
      <p className="deck-note">如果想使用自己的 Anki 卡组，请联系作者。</p>
      {details && <DeckDetails lesson={lesson} onClose={() => setDetails(false)} />}
    </div>
  )
}
