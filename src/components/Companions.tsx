import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { growthStage, PETS, type CompanionPreferences, type ActivePetId, type PetPose } from '../lib/companions'
import golden from '../assets/companions/golden-retriever.png'
import tuxedo from '../assets/companions/tuxedo-cat.png'
import goldenReading from '../assets/companions/golden-reading.png'
import tuxedoReading from '../assets/companions/tuxedo-reading.png'
import goldenTurn from '../assets/companions/golden-turn.png'
import tuxedoTurn from '../assets/companions/tuxedo-turn.png'
import { PET_BOOKS } from '../lib/pet-books'

const artwork = { golden, tuxedo }
const readingArtwork = { golden: goldenReading, tuxedo: tuxedoReading }
const turningArtwork = { golden: goldenTurn, tuxedo: tuxedoTurn }

function useCompanionMotion(enabled: boolean) {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!media) return
    const update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return enabled && !reduced
}

function PetFreeTime({ petId, animate }: { petId: ActivePetId; animate: boolean }) {
  const [bookIndex, setBookIndex] = useState(0)
  const [page, setPage] = useState(0)
  const [visible, setVisible] = useState(() => !document.hidden)
  const [artReady, setArtReady] = useState(false)
  const book = PET_BOOKS[petId][bookIndex]!
  const nextPage = () => setPage((value) => value + 1)
  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  useEffect(() => {
    if (!animate) return
    const timer = window.setInterval(() => {
      if (document.hidden) return
      setPage((value) => value + 1)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [animate])
  const preventBlur = (event: React.PointerEvent) => event.preventDefault()
  return <div className="pet-free-time" data-animate={animate}>
    <div className="pet-activity-picture" data-pet={petId} aria-hidden="true">
      {bookIndex === 0
        ? <span key={`turn:${page}`} className="pet-activity-frame pet-turn-frame" data-turning={animate && artReady && page > 0}
          style={{ '--book': bookIndex, animationPlayState: visible ? 'running' : 'paused' } as CSSProperties}>
          <img src={turningArtwork[petId]} alt="" draggable="false" onLoad={() => setArtReady(true)} />
        </span>
        : <span className="pet-activity-frame" style={{ '--book': bookIndex } as CSSProperties}><img src={readingArtwork[petId]} alt="" draggable="false" /></span>}
    </div>
    <div className="pet-activity-copy">
      <span className="pet-activity-label">自习时间</span>
      <strong>《{book.title}》</strong>
      <p key={`${bookIndex}:${page}`}>{book.pages[page % book.pages.length]}</p>
      <small>第 {page % book.pages.length + 1} / {book.pages.length} 页</small>
    </div>
    <div className="pet-activity-actions">
        <button type="button" onPointerDown={preventBlur} onClick={nextPage}>翻一页</button>
        <button type="button" onPointerDown={preventBlur} onClick={() => { setBookIndex((value) => (value + 1) % PET_BOOKS[petId].length); setPage(0) }}>换本书</button>
    </div>
  </div>
}

export function PracticeCompanions({ preferences, points, typed, complete }: {
  preferences: CompanionPreferences; points: Record<ActivePetId, number>; typed: string; complete: boolean
}) {
  const animate = useCompanionMotion(preferences.animations)
  if (!preferences.enabled) return null
  return <div className="companion-sides" aria-label="陪练伙伴">
    {PETS.map((pet) => {
      const active = pet.id === preferences.petId
      return <aside key={pet.id} className={`pet-side pet-side--${pet.id}`} data-active={active} aria-label={`${pet.name}${active ? '陪你练习' : '的课余时间'}`}>
        <div className="pet-side-heading"><strong>{pet.name}</strong><span>{active ? '陪你练习' : '也在悄悄努力'}</span></div>
        {active ? <PracticeCompanion preferences={{ ...preferences, animations: animate }} points={points[pet.id]} typed={typed} complete={complete} />
          : <PetFreeTime petId={pet.id} animate={animate} />}
      </aside>
    })}
  </div>
}

export function CompanionSprite({ petId, pose = 'idle', stage = 1, animate = false }: { petId: ActivePetId; pose?: PetPose; stage?: number; animate?: boolean }) {
  return <span className="pet-sprite" data-motion={animate ? pose : 'still'} data-stage={stage} aria-hidden="true">
    <span className="companion-frame" style={{ '--pose': { idle: 0, typing: 1, cheer: 2 }[pose] } as CSSProperties}>
      <img src={artwork[petId]} alt="" draggable="false" decoding="async" />
    </span>
    {stage >= 2 && <span className="companion-accessory" title={stage === 3 ? '知己花环' : '默契星星'}>
      <svg viewBox="0 0 48 48" fill="none">
        {stage === 3 && <g stroke="#628667" strokeWidth="3" strokeLinecap="round"><path d="M19 42C1 36 1 16 13 7M29 42C47 36 47 16 35 7"/><path d="M10 14 4 12m4 11-6-2m9 12-6 1m33-20 6-2m-4 11 6-2m-9 12 6 1"/></g>}
        <path d="m24 9 4.4 9 10 1.5-7.2 7 1.7 10L24 32l-8.9 4.5 1.7-10-7.2-7 10-1.5z" fill="#e9bd6e" stroke="#936b37" strokeWidth="1.7" strokeLinejoin="round"/>
      </svg>
    </span>}
  </span>
}

export function CompanionHome({ preferences, points, ready, disabled, onChange }: {
  preferences: CompanionPreferences; points: Record<ActivePetId, number>; ready: boolean; disabled: boolean
  onChange: (next: CompanionPreferences) => void
}) {
  const selected = PETS.find((pet) => pet.id === preferences.petId)!
  const growth = growthStage(points[selected.id])
  return <section className="companion-home" aria-labelledby="companion-title">
    <div className="companion-heading"><div><span className="eyebrow">一起敲敲</span><h2 id="companion-title">今天，谁陪你练习？</h2></div>
      <p>每完成并保存一句，当前伙伴成长 +1。<br />不催促，不掉级，慢慢变成老朋友。</p></div>
    <div className="companion-choices" role="group" aria-label="选择陪练伙伴">
      {PETS.map((pet) => {
        const state = growthStage(points[pet.id]), active = preferences.petId === pet.id
        return <button className="companion-choice" type="button" key={pet.id} aria-pressed={active} disabled={disabled || !ready}
          onClick={() => onChange({ ...preferences, petId: pet.id })}>
          <span className="companion-selected">{active ? '正在陪你' : '选择伙伴'}</span>
          <CompanionSprite petId={pet.id} stage={state.stage} />
          <strong>{pet.name}</strong><span className="companion-intro">{pet.intro}</span>
          <span className="companion-card-stat">{ready ? `${state.name} · ${points[pet.id]} 成长` : '正在读取…'}</span>
        </button>
      })}
    </div>
    <div className="companion-growth" aria-label={`${selected.name}的成长进度`}>
      <div><strong>{selected.name} · {growth.name}</strong><span>{!ready ? '正在读取…' : growth.next ? `再完成 ${growth.remaining} 句，解锁${growth.stage === 1 ? '默契星星' : '知己花环'}` : '知己花环已解锁，继续积累属于你们的练习时光。'}</span></div>
      <div className="companion-growth-track" role="progressbar" aria-label="伙伴成长阶段" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(growth.percent)} aria-valuetext={`${points[selected.id]} 成长，${growth.name}`}><span style={{ width: `${growth.percent}%` }} /></div>
    </div>
    <div className="companion-options">
      <label><input type="checkbox" checked={preferences.enabled} disabled={disabled} onChange={(event) => onChange({ ...preferences, enabled: event.target.checked })} />练习时显示伙伴</label>
      <label><input type="checkbox" checked={preferences.animations} disabled={disabled} onChange={(event) => onChange({ ...preferences, animations: event.target.checked })} />伙伴自动翻页</label>
      <span>30 成长解锁星星 · 150 成长解锁花环。四种评分奖励相同，隐藏伙伴也会成长。</span>
    </div>
  </section>
}

export function PracticeCompanion({ preferences, points, typed, complete }: { preferences: CompanionPreferences; points: number; typed: string; complete: boolean }) {
  const [pose, setPose] = useState<PetPose>('idle')
  const [reward, setReward] = useState(false)
  const previousPoints = useRef(points)
  const previousTyped = useRef(typed)
  const lastReward = useRef(0)
  const pet = PETS.find((entry) => entry.id === preferences.petId)!
  useEffect(() => {
    const gained = points > previousPoints.current
    const changed = typed !== previousTyped.current && typed.length > 0
    previousPoints.current = points; previousTyped.current = typed
    if (gained) lastReward.current = Date.now() + 1200
    const celebrating = complete || lastReward.current > Date.now()
    setReward(lastReward.current > Date.now())
    setPose(celebrating ? 'cheer' : changed ? 'typing' : 'idle')
    const timer = window.setTimeout(() => { setPose(complete ? 'cheer' : 'idle'); setReward(false) }, celebrating ? 1200 : 500)
    return () => window.clearTimeout(timer)
  }, [typed, complete, points])
  if (!preferences.enabled) return null
  return <div className="practice-companion" aria-label={`${pet.name}正在陪你练习`}>
    <CompanionSprite petId={pet.id} pose={pose} stage={growthStage(points).stage} animate={preferences.animations} />
    <span className="companion-bubble">{reward ? '已保存，成长 +1' : pose === 'cheer' ? pet.cheer : pose === 'typing' ? pet.typing : pet.idle}</span>
  </div>
}

export function ResultCompanion({ petId, points, gained, animate }: { petId: ActivePetId; points: number; gained: number; animate: boolean }) {
  const pet = PETS.find((entry) => entry.id === petId)!, growth = growthStage(points)
  return <div className="result-companion"><CompanionSprite petId={petId} pose={gained ? 'cheer' : 'idle'} stage={growth.stage} animate={animate} />
    <p>{pet.name}{gained ? ` 成长 +${gained}` : '等你下次一起练习'}<span>{growth.name} · 累计 {points} 成长</span></p></div>
}
