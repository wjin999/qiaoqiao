import { useEffect, useMemo, useRef, useState } from 'react'
import { buildActivity, localDateKey } from '../lib/activity'
import { CLOUD_APPLIED, LOCAL_CHANGED } from '../lib/account-scope'
import { loadActivityRecords, PROGRESS_UPDATED_KEY } from '../lib/storage'

export function ActivityHeatmap() {
  const [records, setRecords] = useState<Awaited<ReturnType<typeof loadActivityRecords>>>({ reviews: [], history: [] })
  const [today, setToday] = useState(() => new Date())
  const [selected, setSelected] = useState(() => localDateKey(new Date()))
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const initialScroll = useRef(false)
  const activity = useMemo(() => buildActivity(records.reviews, records.history, today), [records, today])
  const selectedDay = activity.days.find((day) => day.date === selected) ?? activity.days[activity.days.length - 1]!
  const columns = Math.ceil((activity.leading + activity.days.length) / 7)
  useEffect(() => {
    let active = true, version = 0
    let timer: number | undefined
    const refresh = async () => {
      const current = ++version
      try {
        const next = await loadActivityRecords()
        if (active && current === version) { setRecords(next); setError(false); setLoaded(true) }
      } catch { if (active && current === version) setError(true) }
    }
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void refresh(), 100) }
    const storage = (event: StorageEvent) => { if (event.key === PROGRESS_UPDATED_KEY || event.key === null) schedule() }
    void refresh()
    window.addEventListener(CLOUD_APPLIED, schedule); window.addEventListener(LOCAL_CHANGED, schedule)
    window.addEventListener('storage', storage)
    const midnight = window.setInterval(() => setToday((previous) => localDateKey(previous) === localDateKey(new Date()) ? previous : new Date()), 60000)
    return () => {
      active = false; window.clearTimeout(timer); window.clearInterval(midnight)
      window.removeEventListener(CLOUD_APPLIED, schedule); window.removeEventListener(LOCAL_CHANGED, schedule); window.removeEventListener('storage', storage)
    }
  }, [])
  useEffect(() => {
    if (loaded && !initialScroll.current && scroller.current) { scroller.current.scrollLeft = scroller.current.scrollWidth; initialScroll.current = true }
  }, [loaded])
  function navigate(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const steps: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7, Home: -index, End: activity.days.length - 1 - index }
    const step = steps[event.key]
    if (step === undefined) return
    event.preventDefault()
    const day = activity.days[Math.max(0, Math.min(activity.days.length - 1, index + step))]!
    setSelected(day.date)
    scroller.current?.querySelector<HTMLButtonElement>(`[data-date="${day.date}"]`)?.focus()
  }
  return <section className="activity-card" aria-label="学习活动热图">
    <div className="activity-heading"><h3>一点一点，敲出进步</h3><span>{loaded ? `过去一年 ${activity.total} 句次 · 练习 ${activity.activeDays} 天` : '正在读取学习活动…'}</span></div>
    {error ? <p role="alert">学习活动暂时读取失败，请刷新重试。</p> : <>
      <div className="activity-scroll" ref={scroller}>
        <div className="activity-chart" style={{ '--weeks': columns } as React.CSSProperties}>
          <div className="activity-months" aria-hidden="true">{activity.days.map((day, index) => {
            const column = Math.floor((activity.leading + index) / 7) + 1
            return day.date.endsWith('-01') && column <= columns - 2 ? <span key={day.date} style={{ gridColumn: column }}>{Number(day.date.slice(5, 7))}月</span> : null
          })}</div>
          <div className="activity-weekdays" aria-hidden="true"><span>一</span><span>三</span><span>五</span><span>日</span></div>
          <div className="activity-grid" role="group" aria-label="过去一年的每日练习，方向键切换日期">
            {Array.from({ length: activity.leading }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
            {activity.days.map((day, index) => <button type="button" key={day.date} data-date={day.date} data-level={day.level}
              className="activity-day" aria-label={`${day.date}，练习 ${day.count} 句次`} title={`${day.date} · ${day.count} 句次`}
              aria-pressed={selectedDay.date === day.date} tabIndex={selectedDay.date === day.date ? 0 : -1}
              onClick={() => setSelected(day.date)} onKeyDown={(event) => navigate(event, index)} />)}
          </div>
        </div>
      </div>
      <div className="activity-footer"><span role="status">{selectedDay.date} · {selectedDay.count ? `练习 ${selectedDay.count} 句次` : '还没有练习记录'}</span>
        <span className="activity-legend" aria-label="颜色越深，练习越多">少{[0, 1, 2, 3, 4].map((level) => <i key={level} data-level={level} />)}多</span></div>
      <p className="backup-help">按本机日期统计，记忆复习、自由跟打和重复练习均计入。手机上可左右滑动查看。</p>
    </>}
  </section>
}
