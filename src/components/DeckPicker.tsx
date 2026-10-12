import { useState } from 'react'
import type { Lesson, TargetLanguage } from '../types'
import { LANGUAGE_ORDER, LANGUAGES } from '../languages'
import { DeckDetails } from './DeckDetails'

interface Props {
  language: TargetLanguage
  onLanguage: (language: TargetLanguage) => void
  // The chosen language's deck, or null while it loads.
  lesson: Lesson | null
  error: string
  onRetry: () => void
  level: string
  onLevel: (level: string) => void
  disabled?: boolean
}

export function DeckPicker({ language, onLanguage, lesson, error, onRetry, level, onLevel, disabled = false }: Props) {
  const [details, setDetails] = useState(false)
  const copy = LANGUAGES[language]
  const levels = lesson ? ['N5', 'N4', 'N3', 'N2', 'N1'].filter((value) => lesson.items.some((item) => item.level === value)) : []
  return (
    <div className="deck-panel">
      <div className="deck-panel-heading">
        <span className="eyebrow">学习内容</span>
      </div>
      <div className="mode-switch language-switch" role="group" aria-label="学习语言">
        {LANGUAGE_ORDER.map((value) => <button key={value} type="button" disabled={disabled} aria-pressed={language === value}
          onClick={() => onLanguage(value)}>{LANGUAGES[value].name}</button>)}
      </div>
      {lesson ? <>
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
      </> : error ? <p role="alert" className="error-message">{error} <button type="button" className="text-button" onClick={onRetry}>重试</button></p>
        : <p role="status" className="deck-summary">{copy.loading}</p>}
      <div className="deck-example"><p lang={language}>{copy.example.text}</p><span>{copy.example.translation}</span></div>
      <p className="deck-note">如果想使用自己的 Anki 卡组，请联系作者。</p>
      {details && lesson && <DeckDetails lesson={lesson} onClose={() => setDetails(false)} />}
    </div>
  )
}
