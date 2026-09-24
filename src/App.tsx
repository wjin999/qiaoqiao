import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadDefaultDeck } from './lib/default-deck'
import { DeckPicker } from './components/DeckPicker'
import { AnkiImport } from './components/AnkiImport'
import { ProgressBackup } from './components/ProgressBackup'
import { AccountButton, useAccount } from './components/Account'
import { ReviewDock } from './components/ReviewDock'
import { ActivityHeatmap } from './components/ActivityHeatmap'
import { CompanionHome, PracticeCompanions, ResultCompanion } from './components/Companions'
import { companionPreferences, equippedOutfit, petGrowth, PET_PREFERENCE_KEY, type CompanionPreferences } from './lib/companions'
import { preference, savePreference } from './lib/preferences'
import { CLOUD_APPLIED } from './lib/account-scope'
import { DECKS_UPDATED_KEY, loadImportedDecks, saveImportedDeck } from './lib/deck-storage'
import { formatDuration, sampleItems } from './lib/practice'
import {
  addHistoryEntry,
  clearPermanentlySkippedSentences,
  historyCount,
  loadCards,
  loadHistory,
  loadActivityRecords,
  loadPermanentlySkippedSentenceIds,
  PROGRESS_UPDATED_KEY,
  recordReview,
  permanentlySkipSentence,
} from './lib/storage'
import { GRADES, GRADE_LABELS, ratingIntervals, studyPlan, type PracticeMode, type ReviewEntry, type SentenceProgress } from './lib/scheduler'
import type { Grade } from 'ts-fsrs'
import type {
  HistoryEntry,
  Lesson,
  LessonItem,
  PracticeSummary,
} from './types'

const SESSION_SIZE = 10
const SELECTED_DECK_KEY = 'typelingo.selected-deck.v1'
const deckLevelKey = (id: string) => `typelingo.deck-level.v1:${id}`

type Screen = 'home' | 'practice' | 'result'

function App() {
  const [defaultLesson, setDefaultLesson] = useState<Lesson | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    void loadDefaultDeck().then((deck) => { if (active) setDefaultLesson(deck) })
      .catch(() => { if (active) setError('默认卡组加载失败，请检查连接后重试。') })
    return () => { active = false }
  }, [attempt])
  if (!defaultLesson) return <div className="app-shell"><main className="main-content loading-screen">
    <span className="eyebrow">日语敲敲</span><h1>打字，记住日语。</h1>
    <p role={error ? 'alert' : 'status'}>{error || '正在加载 egg rolls 例句库…'}</p>
    {error && <button className="primary-button" type="button" onClick={() => setAttempt((current) => current + 1)}>重试</button>}
  </main></div>
  return <PracticeApp defaultLesson={defaultLesson} />
}

function PracticeApp({ defaultLesson }: { defaultLesson: Lesson }) {
  const { session, syncing, status, sync, setPracticing } = useAccount()
  const [importedDecks, setImportedDecks] = useState<Lesson[]>([])
  const [decksLoaded, setDecksLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState(() => {
    return preference(SELECTED_DECK_KEY, defaultLesson.id)
  })
  const [selectedLevel, setSelectedLevel] = useState(() => preference(deckLevelKey(selectedId), 'all'))
  const [importOpen, setImportOpen] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const lessons = useMemo(() => {
    const byId = new Map([[defaultLesson.id, defaultLesson]])
    for (const deck of importedDecks) byId.set(deck.id, deck.id === defaultLesson.id
      ? { ...deck, metadata: { ...deck.metadata!, builtIn: true } } : deck)
    return [...byId.values()]
  }, [importedDecks, defaultLesson])
  const [sessionLesson, setSessionLesson] = useState<Lesson | null>(null)
  const lesson = sessionLesson ?? lessons.find((deck) => deck.id === selectedId) ?? defaultLesson
  const savedLevel = lesson.id === selectedId ? selectedLevel : preference(deckLevelKey(lesson.id), 'all')
  const level = lesson.items.some((item) => item.level === savedLevel) ? savedLevel : 'all'
  const [screen, setScreen] = useState<Screen>('home')
  const [queue, setQueue] = useState<LessonItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [typed, setTyped] = useState('')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [completedSentenceCount, setCompletedSentenceCount] = useState(0)
  const [summary, setSummary] = useState<PracticeSummary | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)
  const [permanentlySkippedIds, setPermanentlySkippedIds] = useState<string[]>([])
  const [cards, setCards] = useState<SentenceProgress[]>([])
  const [reviews, setReviews] = useState<ReviewEntry[]>([])
  const [companion, setCompanion] = useState(() => companionPreferences(preference(PET_PREFERENCE_KEY, '')))
  const [companionBusy, setCompanionBusy] = useState(false)
  const growth = useMemo(() => petGrowth(reviews), [reviews])
  const [progressReady, setProgressReady] = useState(false)
  const [progressError, setProgressError] = useState('')
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<PracticeMode>(() => preference('typelingo.mode', 'memory') === 'free' ? 'free' : 'memory')
  const [dailyNewLimit, setDailyNewLimit] = useState(() => {
    const value = Number(preference('typelingo.daily-new', '10'))
    return Number.isInteger(value) && value >= 0 && value <= 100 ? value : 10
  })
  const [clockNow, setClockNow] = useState(Date.now())
  const [completedAt, setCompletedAt] = useState<number | null>(null)
  const [showFurigana, setShowFurigana] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const isComposingRef = useRef(false)
  const savingRef = useRef(false)
  const roundIdRef = useRef('')
  const autoSyncedRoundRef = useRef('')
  const sentenceStartedRef = useRef(0)
  const hintUsedRef = useRef(false)
  const sessionCardsRef = useRef<SentenceProgress[]>([])
  const refreshVersionRef = useRef(0)

  const currentItem = queue[currentIndex]
  const isSentenceComplete = completedAt !== null
  const skippedIds = useMemo(() => new Set(permanentlySkippedIds), [permanentlySkippedIds])
  const availableItems = useMemo(() => lesson.items.filter(
    (item) => !skippedIds.has(item.id) && (level === 'all' || item.level === level),
  ), [lesson, skippedIds, level])
  const skippedCount = useMemo(() => lesson.items.filter((item) => skippedIds.has(item.id)).length, [lesson, skippedIds])
  const plan = useMemo(() => studyPlan(availableItems, lesson.id, cards, dailyNewLimit, new Date(clockNow)),
    [availableItems, lesson.id, cards, dailyNewLimit, clockNow])
  const canStart = progressReady && decksLoaded && !saving && !syncing && !companionBusy && (mode === 'free' ? availableItems.length > 0 : plan.queue.length > 0)
  const currentProgress = currentItem ? sessionCardsRef.current.find((entry) => entry.lessonId === lesson.id && entry.sentenceId === currentItem.id) : undefined
  const intervals = completedAt !== null && mode === 'memory' ? ratingIntervals(currentProgress, new Date(completedAt)) : []

  const refreshProgress = useCallback(async () => {
    const version = ++refreshVersionRef.current
    try {
      const [recent, total, skipped, progress, activity] = await Promise.all([
        loadHistory(5, historyPage * 5), historyCount(), loadPermanentlySkippedSentenceIds(), loadCards(), loadActivityRecords(),
      ])
      if (version !== refreshVersionRef.current) return
      setHistory(recent); setHistoryTotal(total); setPermanentlySkippedIds(skipped); setCards(progress)
      setReviews(activity.reviews)
      setProgressReady(true); setProgressError(''); setClockNow(Date.now())
    } catch (error) {
      if (version === refreshVersionRef.current) setProgressError(error instanceof Error ? error.message : '读取学习记录失败。')
    }
  }, [historyPage])

  useEffect(() => {
    void refreshProgress()
    function changed(event: StorageEvent) {
      if (event.key === PROGRESS_UPDATED_KEY || event.key === null) void refreshProgress()
    }
    function focus() { void refreshProgress() }
    window.addEventListener('storage', changed)
    window.addEventListener('focus', focus)
    const timer = window.setInterval(() => setClockNow(Date.now()), 15000)
    return () => { window.removeEventListener('storage', changed); window.removeEventListener('focus', focus); window.clearInterval(timer) }
  }, [refreshProgress])

  useEffect(() => {
    const busy = screen === 'practice' || saving || importOpen || companionBusy
    setPracticing(busy)
    // The final review (including pet growth) must commit before syncing.
    // Mark the attempt first so rerenders and failed requests never loop.
    if (screen === 'result' && !busy && !syncing && session && roundIdRef.current
      && autoSyncedRoundRef.current !== roundIdRef.current) {
      autoSyncedRoundRef.current = roundIdRef.current
      void sync()
    }
  }, [screen, saving, importOpen, companionBusy, syncing, session, sync, setPracticing])
  async function changeCompanion(next: CompanionPreferences) {
    if (companionBusy || syncing) return false
    setCompanionBusy(true)
    try { await savePreference(PET_PREFERENCE_KEY, JSON.stringify(next)); setCompanion(next); return true }
    catch { setProgressError('伙伴设置未能保存，请检查浏览器存储后重试。'); return false }
    finally { setCompanionBusy(false) }
  }
  function persistPreference(key: string, value: string) {
    void savePreference(key, value).catch(() => setProgressError('设置未能保存，请检查浏览器存储后重试。'))
  }
  useEffect(() => {
    function applied() {
      void refreshProgress()
      void loadImportedDecks().then(setImportedDecks).catch(() => setLibraryError('读取同步卡组失败，请刷新重试。'))
      const id = preference(SELECTED_DECK_KEY, defaultLesson.id)
      setSelectedId(id); setSelectedLevel(preference(deckLevelKey(id), 'all'))
      setMode(preference('typelingo.mode', 'memory') === 'free' ? 'free' : 'memory')
      setCompanion(companionPreferences(preference(PET_PREFERENCE_KEY, '')))
      const limit = Number(preference('typelingo.daily-new', '10'))
      setDailyNewLimit(Number.isInteger(limit) && limit >= 0 && limit <= 100 ? limit : 10)
    }
    window.addEventListener(CLOUD_APPLIED, applied)
    return () => window.removeEventListener(CLOUD_APPLIED, applied)
  }, [refreshProgress, defaultLesson.id])

  useEffect(() => {
    let active = true
    function refresh() {
      void loadImportedDecks().then((decks) => {
        if (active) { setImportedDecks(decks); setLibraryError(''); setDecksLoaded(true) }
      }).catch((error) => {
        if (active) { setLibraryError(error instanceof Error ? error.message : '读取卡组失败。'); setDecksLoaded(true) }
      })
    }
    function handleStorage(event: StorageEvent) {
      if (event.storageArea === window.localStorage && (event.key === DECKS_UPDATED_KEY || event.key === null)) refresh()
    }
    refresh()
    window.addEventListener('storage', handleStorage)
    return () => { active = false; window.removeEventListener('storage', handleStorage) }
  }, [])

  function selectDeck(id: string) {
    setSelectedId(id)
    setSelectedLevel(preference(deckLevelKey(id), 'all'))
    persistPreference(SELECTED_DECK_KEY, id)
  }

  function selectLevel(value: string) {
    setSelectedLevel(value)
    persistPreference(deckLevelKey(lesson.id), value)
  }

  async function importDeck(deck: Lesson) {
    await saveImportedDeck(deck)
    setImportedDecks((current) => [...current.filter((item) => item.id !== deck.id), deck])
    setLibraryError('')
    selectDeck(deck.id)
  }

  useEffect(() => {
    if (screen === 'practice') {
      inputRef.current?.focus()
    }
  }, [currentIndex, screen])

  async function startPractice() {
    if (!progressReady || !decksLoaded || savingRef.current || syncing || companionBusy) return
    savingRef.current = true; setSaving(true); setProgressError('')
    try {
      const [latestCards, latestSkipped] = await Promise.all([loadCards(), loadPermanentlySkippedSentenceIds()])
      setCards(latestCards); setPermanentlySkippedIds(latestSkipped); setClockNow(Date.now())
      const skipped = new Set(latestSkipped)
      const available = lesson.items.filter((item) => !skipped.has(item.id) && (level === 'all' || item.level === level))
      const items = mode === 'free' ? sampleItems(available, SESSION_SIZE)
        : studyPlan(available, lesson.id, latestCards, dailyNewLimit).queue
      if (items.length === 0) return

      setQueue(items)
      setSessionLesson(lesson)
      sessionCardsRef.current = latestCards
      roundIdRef.current = crypto.randomUUID()
      setCurrentIndex(0)
      setTyped('')
      setCompletedAt(null)
      setStartedAt(Date.now())
      setCompletedSentenceCount(0)
      setSummary(null)
      setShowFurigana(mode === 'free')
      hintUsedRef.current = mode === 'free'
      sentenceStartedRef.current = Date.now()
      isComposingRef.current = false
      setScreen('practice')
    } catch (error) { setProgressError(error instanceof Error ? error.message : '无法开始练习。') }
    finally { savingRef.current = false; setSaving(false) }
  }

  function handleInputChange(nextValue: string) {
    if (!currentItem || isSentenceComplete) {
      return
    }

    setTyped(nextValue)
    if (!isComposingRef.current && nextValue === currentItem.text) {
      setCompletedAt(Date.now()); if (mode === 'memory') setShowFurigana(true)
    }
  }

  function handleCompositionStart() {
    isComposingRef.current = true
  }

  function handleCompositionEnd(nextValue: string) {
    if (!currentItem) {
      return
    }

    isComposingRef.current = false
    setTyped(nextValue)
    if (nextValue === currentItem.text) {
      setCompletedAt(Date.now()); if (mode === 'memory') setShowFurigana(true)
    }
  }

  function completePractice(sentenceCount: number) {
    const elapsedMs = Math.max(1, Date.now() - (startedAt ?? Date.now()))
    const nextSummary: PracticeSummary = {
      elapsedMs,
      sentenceCount,
    }

    setSummary(nextSummary)
    setScreen('result')
    void refreshProgress()
  }

  function advanceFromCurrent(sentenceCount: number) {
    if (currentIndex + 1 >= queue.length) {
      completePractice(sentenceCount)
      return
    }

    setCurrentIndex((current) => current + 1)
    setTyped('')
    setCompletedAt(null)
    setShowFurigana(mode === 'free')
    hintUsedRef.current = mode === 'free'
    sentenceStartedRef.current = Date.now()
    isComposingRef.current = false
  }

  function roundHistory(sentenceCount: number): HistoryEntry {
    return { id: roundIdRef.current, completedAt: new Date().toISOString(),
      lessonId: lesson.id, lessonTitle: lesson.title, sentenceCount,
      elapsedMs: Math.max(1, Date.now() - (startedAt ?? Date.now())), mode,
      partial: currentIndex + 1 < queue.length }
  }

  async function submitSentence(grade: Grade | null) {
    if (!currentItem || completedAt === null || isComposingRef.current || savingRef.current) return
    savingRef.current = true; setSaving(true); setProgressError('')
    try {
      const nextCount = completedSentenceCount + 1
      const review: ReviewEntry = { id: `${roundIdRef.current}:${currentIndex}`, lessonId: lesson.id,
        sentenceId: currentItem.id, reviewedAt: new Date(completedAt).toISOString(), mode, rating: grade,
        hintUsed: hintUsedRef.current, elapsedMs: Math.max(0, completedAt - sentenceStartedRef.current), petId: companion.petId }
      await recordReview(review,
        currentItem, roundHistory(nextCount), currentProgress?.updatedAt)
      setReviews((current) => current.some((entry) => entry.id === review.id) ? current : [...current, review])
      setCompletedSentenceCount(nextCount)
      advanceFromCurrent(nextCount)
    } catch (error) { setProgressError(error instanceof Error ? error.message : '保存失败，请重试。') }
    finally { savingRef.current = false; setSaving(false); inputRef.current?.focus() }
  }

  async function skipCurrentSentence(permanent: boolean) {
    if (!currentItem || savingRef.current || isSentenceComplete) return
    savingRef.current = true; setSaving(true); setProgressError('')
    try {
      if (permanent) setPermanentlySkippedIds(await permanentlySkipSentence(permanentlySkippedIds, currentItem.id))
      if (currentIndex + 1 >= queue.length) await addHistoryEntry([], roundHistory(completedSentenceCount))
      advanceFromCurrent(completedSentenceCount)
    } catch (error) { setProgressError(error instanceof Error ? error.message : '保存失败，请重试。') }
    finally { savingRef.current = false; setSaving(false) }
  }

  async function restorePermanentlySkippedSentences() {
    try { setPermanentlySkippedIds(await clearPermanentlySkippedSentences(lesson.items.map((item) => item.id))) }
    catch (error) { setProgressError(error instanceof Error ? error.message : '恢复失败。') }
  }

  useEffect(() => {
    function onRatingKey(event: KeyboardEvent) {
      if (screen !== 'practice' || !isSentenceComplete || mode !== 'memory' || event.repeat
        || event.isComposing || event.keyCode === 229 || isComposingRef.current
        || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault()
        void submitSentence(Number(event.key) as Grade)
      }
    }
    window.addEventListener('keydown', onRatingKey)
    return () => window.removeEventListener('keydown', onRatingKey)
  })

  function toggleFurigana() {
    if (!showFurigana && !isSentenceComplete) hintUsedRef.current = true
    setShowFurigana((current) => !current)
    inputRef.current?.focus()
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const isImeAction =
      event.nativeEvent.isComposing ||
      isComposingRef.current ||
      event.key === 'Process' ||
      event.keyCode === 229

    if (event.key === 'Tab' && !isImeAction && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault()
      if (!event.repeat) toggleFurigana()
      return
    }

    if (event.key === 'Enter' && !isImeAction) {
      event.preventDefault()
      if (mode === 'free' && !event.repeat) void submitSentence(null)
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" type="button" disabled={saving} onClick={() => { setSessionLesson(null); setScreen('home'); void refreshProgress() }}>
          <span className="brand-mark" aria-hidden="true">
            敲
          </span>
          <span>日语敲敲</span>
        </button>
        <AccountButton disabled={screen === 'practice' || saving || importOpen || companionBusy} />
      </header>

      <main className="main-content">
        {progressError && <p role="alert" className="error-message">{progressError} {screen === 'home' && <button type="button" className="text-button" onClick={() => void refreshProgress()}>重试读取</button>}</p>}
        {screen === 'home' && libraryError && <p role="alert" className="error-message">{libraryError} 默认卡组仍可练习。</p>}
        {screen === 'home' && (
          <HomeScreen
            history={history}
            historyTotal={historyTotal}
            historyPage={historyPage}
            onHistoryPage={setHistoryPage}
            canStart={canStart}
            loading={!progressReady || !decksLoaded || saving || syncing}
            permanentlySkippedCount={skippedCount}
            onStart={startPractice}
            onRestoreSkipped={restorePermanentlySkippedSentences}
            progressBackup={<>{session && <ActivityHeatmap />}<ProgressBackup onRestore={() => { setHistoryPage(0); void refreshProgress() }} /></>}
            companionPanel={<CompanionHome preferences={companion} points={growth} ready={progressReady} disabled={saving || syncing || companionBusy} onChange={changeCompanion} />}
            practiceOptions={<div className="practice-options">
              <div className="mode-switch" role="group" aria-label="练习方式">
                <button type="button" disabled={saving || syncing} aria-pressed={mode === 'memory'} onClick={() => { setMode('memory'); persistPreference('typelingo.mode', 'memory') }}>记忆复习</button>
                <button type="button" disabled={saving || syncing} aria-pressed={mode === 'free'} onClick={() => { setMode('free'); persistPreference('typelingo.mode', 'free') }}>自由跟打</button>
              </div>
              {mode === 'memory' ? <>
                <p>先回忆读音，再跟打核对。完成后按 1–4 评分，安排下次复习。</p>
                <label className="daily-new-label">每天新句上限（当前卡组）<input aria-label="每天新句上限" type="number" min="0" max="100" value={dailyNewLimit}
                  disabled={syncing} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value <= 100) { setDailyNewLimit(value); persistPreference('typelingo.daily-new', String(value)) } }} /></label>
                <p aria-live="polite">到期 {plan.dueCount} 句 · 本轮新句 {plan.newCount} 句 · 今日已学新句 {plan.introducedToday} 句</p>
                {progressReady && !plan.queue.length && <p>当前范围暂时没有待复习内容。{plan.nextDue ? `下次到期：${new Date(plan.nextDue).toLocaleString('zh-CN')}` : '可以调整等级、新句上限，或自由跟打。'}</p>}
              </> : <p>随机选句，默认显示注音；完成后按 Enter 继续，不改变记忆复习计划。</p>}
            </div>}
            deckPicker={<DeckPicker lessons={lessons} lesson={lesson} onSelect={selectDeck} onImport={() => setImportOpen(true)} level={level} onLevel={selectLevel} disabled={!decksLoaded || saving || syncing} />}
          />
        )}

        {screen === 'practice' && currentItem && (
          <section className="practice-screen" aria-label="日语跟打练习">
            <div className="practice-meta">
              <span className="eyebrow">{lesson.title}{currentItem.level ? ` · ${currentItem.level}` : ''}</span>
              <span className="progress-count">
                {currentIndex + 1} / {queue.length}
              </span>
            </div>

            <div className="progress-track" aria-hidden="true">
              <span
                style={{ width: `${((currentIndex + 1) / queue.length) * 100}%` }}
              />
            </div>

            <PracticeCompanions preferences={companion} points={growth} typed={typed} complete={isSentenceComplete} />
            <div className="typing-card">
              <div className="practice-line native-line">
                <p className="native-sentence" lang="zh-CN">
                  {currentItem.nativeText}
                </p>
              </div>

              <div className="practice-line japanese-line">
                <div className="line-heading">
                  <button
                    className="furigana-toggle"
                    type="button"
                    aria-pressed={showFurigana}
                    aria-keyshortcuts="Tab"
                    onClick={toggleFurigana}
                  >
                    汉字注音：{showFurigana ? '开' : '关'} · Tab
                  </button>
                </div>
                <p className="sentence" lang="ja" aria-label={currentItem.text}>
                  <JapaneseSentence
                    item={currentItem}
                    typed={typed}
                    showFurigana={showFurigana}
                  />
                </p>
              </div>

              <div className="practice-line input-line">
                <input
                  ref={inputRef}
                  id="typing-input"
                  className={isSentenceComplete ? 'typing-input is-complete' : 'typing-input'}
                  type="text"
                  lang="ja"
                  value={typed}
                  readOnly={isSentenceComplete}
                  disabled={saving && !isSentenceComplete}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => handleInputChange(event.target.value)}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={(event) => handleCompositionEnd(event.currentTarget.value)}
                  onKeyDown={handleInputKeyDown}
                  onPaste={(event) => event.preventDefault()}
                  aria-label="你的输入"
                  aria-describedby="typing-help"
                />

                <div className="typing-footer" id="typing-help">
                  <span className="desktop-input-help">
                    请使用日语输入法；Backspace 修正，Tab 切换注音，Shift+Tab 移动焦点。
                  </span>
                  <span className="mobile-input-help">使用日语输入法，完成后{mode === 'memory' ? '点击评分' : '进入下一句'}。</span>
                  {isSentenceComplete && <strong className="ready-message is-visible">
                    {mode === 'memory' ? '输入已锁定，按 1–4 评价记忆' : '输入完成，按 Enter 继续'}
                  </strong>}
                </div>
                {mode === 'memory' && isSentenceComplete && <ReviewDock><div className="rating-panel" aria-label="评价这句的记忆">
                  <p role="status"><span className="desktop-input-help">{saving ? '正在保存…' : '按看注音前的回忆评分：想不起来选「重来」，费力但想起来选「困难」。'}</span>
                    <span className="mobile-input-help">{saving ? '正在保存…' : '按看注音前的回忆，选择评分'}</span></p>
                  <div className="rating-options">
                    {GRADES.map((grade, index) => <button key={grade} className={`rating-button rating-${grade}`} type="button"
                      disabled={saving} onPointerDown={(event) => { if (event.pointerType === 'touch') event.preventDefault() }} onClick={() => void submitSentence(grade)} aria-keyshortcuts={String(grade)}>
                      <strong>{GRADE_LABELS[index]}</strong><span>{intervals[index]}后</span><kbd>{grade}</kbd>
                    </button>)}
                  </div>
                </div></ReviewDock>}
                {mode === 'free' && isSentenceComplete && <ReviewDock><div className="rating-panel free-next-panel">
                  <button type="button" className="primary-button" disabled={saving} onClick={() => void submitSentence(null)}>{saving ? '正在保存…' : '下一句'} <kbd>Enter</kbd></button>
                </div></ReviewDock>}
              </div>
            </div>

            {!isSentenceComplete && <div className="skip-actions" aria-label="跳过当前句子">
              <button
                className="skip-button"
                type="button"
                disabled={saving}
                onClick={() => skipCurrentSentence(false)}
              >
                本次跳过该句
              </button>
              <button
                className="skip-button skip-button--permanent"
                type="button"
                disabled={saving}
                onClick={() => skipCurrentSentence(true)}
              >
                永远跳过该句
              </button>
            </div>}
          </section>
        )}

        {screen === 'result' && summary && (
          <ResultScreen
            summary={summary}
            syncStatus={session ? status : undefined}
            syncing={syncing}
            companion={<ResultCompanion petId={companion.petId} points={growth[companion.petId]} gained={summary.sentenceCount} animate={companion.animations} outfit={equippedOutfit(companion, companion.petId, growth[companion.petId])} />}
            canRestart={canStart}
            onRestart={startPractice}
            onHome={() => { setSessionLesson(null); setScreen('home') }}
          />
        )}
      </main>

      {importOpen && <AnkiImport onClose={() => setImportOpen(false)} onSave={importDeck} />}

      <footer className="site-footer">
        {session ? '账号记录保存在本机，点击「同步」保存到云端；请定期备份' : '游客记录保存在当前浏览器，请定期备份'} · 日语敲敲 v0.5
      </footer>
    </div>
  )
}

interface JapaneseSentenceProps {
  item: LessonItem
  typed: string
  showFurigana: boolean
}

function JapaneseSentence({ item, typed, showFurigana }: JapaneseSentenceProps) {
  let offset = 0

  return item.ruby.map((part, partIndex) => {
    const startIndex = offset
    offset += part.text.length
    const base = part.text.split('').map((character, characterIndex) => {
      const index = startIndex + characterIndex
      const enteredCharacter = typed[index]
      const state =
        enteredCharacter === undefined
          ? 'pending'
          : enteredCharacter === character
            ? 'correct'
            : 'incorrect'

      return (
        <span className={`character character--${state}`} key={index}>
          {character}
        </span>
      )
    })

    if (showFurigana && part.reading) {
      return (
        <ruby className="ruby-group" key={partIndex}>
          {base}
          <rt>{part.reading}</rt>
        </ruby>
      )
    }

    return (
      <span className="ruby-group" key={partIndex}>
        {base}
      </span>
    )
  })
}

interface HomeScreenProps {
  history: HistoryEntry[]
  historyTotal: number
  historyPage: number
  onHistoryPage: (page: number) => void
  canStart: boolean
  loading: boolean
  permanentlySkippedCount: number
  onStart: () => void
  onRestoreSkipped: () => void
  deckPicker: React.ReactNode
  progressBackup: React.ReactNode
  practiceOptions: React.ReactNode
  companionPanel: React.ReactNode
}

function HomeScreen({
  history,
  historyTotal,
  historyPage,
  onHistoryPage,
  canStart,
  loading,
  permanentlySkippedCount,
  onStart,
  onRestoreSkipped,
  deckPicker,
  progressBackup,
  practiceOptions,
  companionPanel,
}: HomeScreenProps) {
  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <h1 id="home-title">
            打字，记住日语。
          </h1>
          <p>
            以假名输入联结汉字、读音与语义，沿助词与句型梳理表达结构。<br />
            让每次敲击，都成为有语境的日语练习。
          </p>
          {practiceOptions}
          <button
            className="primary-button"
            type="button"
            onClick={onStart}
            disabled={!canStart}
          >
            {loading ? '正在读取进度…' : canStart ? '开始练习' : '暂时没有待练句子'}
            <span aria-hidden="true">→</span>
          </button>
          {permanentlySkippedCount > 0 && (
            <button
              className="restore-skipped-button"
              type="button"
              onClick={onRestoreSkipped}
            >
              已永久跳过 {permanentlySkippedCount} 句 · 恢复全部
            </button>
          )}
        </div>

        {deckPicker}
      </section>

      {companionPanel}

      <section className="history-section" aria-labelledby="history-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">练习记录</span>
            <h2 id="history-title">最近成绩</h2>
          </div>
          <span className="storage-note">共 {historyTotal} 轮 · 长期保存</span>
        </div>

        {progressBackup}

        {history.length === 0 ? (
          <div className="empty-history">
            <span>—</span>
            <p>完成第一次练习后，成绩会显示在这里。</p>
          </div>
        ) : (
          <div className="history-list">
            {history.map((entry) => (
              <article className="history-row" key={entry.id}>
                <time dateTime={entry.completedAt}>
                  {new Intl.DateTimeFormat('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(entry.completedAt))}
                  {entry.lessonTitle && <small className="history-deck">{entry.lessonTitle}</small>}
                </time>
                <strong>完成 {entry.sentenceCount} 句{entry.partial && <small className="history-deck">未结束的一轮 · 已保存</small>}</strong>
                <span>{formatDuration(entry.elapsedMs)}</span>
              </article>
            ))}
          </div>
        )}
        {historyTotal > 5 && <nav className="history-pagination" aria-label="成绩分页">
          <button type="button" className="text-button" disabled={historyPage === 0} onClick={() => onHistoryPage(historyPage - 1)}>上一页</button>
          <span>{historyPage + 1} / {Math.ceil(historyTotal / 5)}</span>
          <button type="button" className="text-button" disabled={(historyPage + 1) * 5 >= historyTotal} onClick={() => onHistoryPage(historyPage + 1)}>下一页</button>
        </nav>}
      </section>
    </>
  )
}

interface ResultScreenProps {
  summary: PracticeSummary
  syncStatus?: string
  syncing: boolean
  companion: React.ReactNode
  canRestart: boolean
  onRestart: () => void
  onHome: () => void
}

function ResultScreen({ summary, syncStatus, syncing, companion, canRestart, onRestart, onHome }: ResultScreenProps) {
  return (
    <section className="result-screen" aria-labelledby="result-title">
      {companion}
      <span className="eyebrow">本轮完成</span>
      <h1 id="result-title">练习完成</h1>
      {syncStatus !== undefined && <p className="backup-help" role="status">{syncStatus || '本轮已保存，准备同步…'}</p>}
      <p className="result-subtitle">
        {syncing ? '正在同步本轮进度与宠物成长，完成后可继续练习。' : !canRestart
          ? '当前范围暂时没有待练句子，可回到主页查看复习安排或自由跟打。'
          : summary.sentenceCount > 0
            ? `完成 ${summary.sentenceCount} 个句子，继续保持这份节奏。`
            : '本轮已结束，你可以返回主页或再来一组。'}
      </p>

      <div className="result-grid">
        <article>
          <span>本轮完成</span>
          <strong>{summary.sentenceCount}</strong>
          <small>句</small>
        </article>
        <article>
          <span>练习用时</span>
          <strong>{formatDuration(summary.elapsedMs)}</strong>
          <small>分:秒</small>
        </article>
      </div>

      <div className="result-actions">
        <button className="secondary-button" type="button" onClick={onHome}>
          回到主页
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={onRestart}
          disabled={!canRestart}
        >
          再来一组
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  )
}

export default App
