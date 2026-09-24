import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { equippedOutfit, growthStage, PETS, type OutfitId, type CompanionPreferences, type ActivePetId, type PetPose } from '../lib/companions'
import { PET_BOOKS } from '../lib/pet-books'
import { Wardrobe } from './Wardrobe'
import { PetArtwork, TurningArtwork } from './PetArtwork'

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

export function PetFreeTime({ petId, animate, outfit = 'natural' }: { petId: ActivePetId; animate: boolean; outfit?: OutfitId }) {
  const motion = useCompanionMotion(animate)
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
    if (!motion) return
    const timer = window.setInterval(() => {
      if (document.hidden) return
      setPage((value) => value + 1)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [motion])
  const preventBlur = (event: React.PointerEvent) => event.preventDefault()
  return <div className="pet-free-time" data-animate={motion}>
    <div className="pet-activity-picture" data-pet={petId} aria-hidden="true">
      {bookIndex === 0
        ? <span key={`turn:${page}`} className="pet-activity-frame pet-turn-frame" data-turning={motion && artReady && page > 0}
          style={{ '--book': bookIndex, animationPlayState: visible ? 'running' : 'paused' } as CSSProperties}>
          <TurningArtwork pet={petId} outfit={outfit} playing={motion && artReady && page > 0} visible={visible} onLoad={() => setArtReady(true)} />
        </span>
        : <span className="pet-activity-frame" style={{ '--book': bookIndex } as CSSProperties}><PetArtwork pet={petId} outfit={outfit} kind="reading" frame={bookIndex} /></span>}
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
          : <PetFreeTime petId={pet.id} animate={animate} outfit={equippedOutfit(preferences, pet.id, points[pet.id])} />}
      </aside>
    })}
  </div>
}

export function CompanionSprite({ petId, pose = 'idle', stage = 1, animate = false, outfit = 'natural' }: { petId: ActivePetId; pose?: PetPose; stage?: number; animate?: boolean; outfit?: OutfitId }) {
  return <span className="pet-sprite" data-motion={animate ? pose : 'still'} data-stage={stage} aria-hidden="true">
    <span className="companion-frame"><PetArtwork pet={petId} outfit={outfit} frame={{ idle: 0, typing: 1, cheer: 2 }[pose]} /></span>
  </span>
}

export function CompanionHome({ preferences, points, ready, disabled, onChange }: {
  preferences: CompanionPreferences; points: Record<ActivePetId, number>; ready: boolean; disabled: boolean
  onChange: (next: CompanionPreferences) => Promise<boolean>
}) {
  const [wardrobeOpen, setWardrobeOpen] = useState(false)
  const wardrobeTrigger = useRef<HTMLButtonElement>(null)
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
          <CompanionSprite petId={pet.id} stage={state.stage} outfit={equippedOutfit(preferences, pet.id, points[pet.id])} />
          <strong>{pet.name}</strong><span className="companion-intro">{pet.intro}</span>
          <span className="companion-card-stat">{ready ? `${state.name} · ${points[pet.id]} 成长` : '正在读取…'}</span>
        </button>
      })}
    </div>
    <div className="companion-growth" aria-label={`${selected.name}的成长进度`}>
      <div><strong>{selected.name} · {growth.name}</strong><span>{!ready ? '正在读取…' : growth.next ? `再完成 ${growth.remaining} 句，解锁${growth.stage === 1 ? '日常外套' : '冒险服装'}` : '全部服装已解锁，去衣柜试穿吧。'}</span></div>
      <div className="companion-growth-track" role="progressbar" aria-label="伙伴成长阶段" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(growth.percent)} aria-valuetext={`${points[selected.id]} 成长，${growth.name}`}><span style={{ width: `${growth.percent}%` }} /></div>
    </div>
    <button ref={wardrobeTrigger} className="wardrobe-open" type="button" disabled={disabled || !ready} onClick={() => setWardrobeOpen(true)}>打开伙伴衣柜 · 换装</button>
    {wardrobeOpen && <Wardrobe preferences={preferences} points={points} disabled={disabled} onChange={onChange} onClose={() => { setWardrobeOpen(false); wardrobeTrigger.current?.focus() }} />}
    <div className="companion-options">
      <label><input type="checkbox" checked={preferences.enabled} disabled={disabled} onChange={(event) => onChange({ ...preferences, enabled: event.target.checked })} />练习时显示伙伴</label>
      <label><input type="checkbox" checked={preferences.animations} disabled={disabled} onChange={(event) => onChange({ ...preferences, animations: event.target.checked })} />伙伴自动翻页</label>
      <span>30 成长解锁日常外套 · 150 成长解锁冒险服装。四种评分奖励相同，隐藏伙伴也会成长。</span>
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
    <CompanionSprite petId={pet.id} pose={pose} stage={growthStage(points).stage} animate={preferences.animations} outfit={equippedOutfit(preferences, pet.id, points)} />
    <span className="companion-bubble">{reward ? '已保存，成长 +1' : pose === 'cheer' ? pet.cheer : pose === 'typing' ? pet.typing : pet.idle}</span>
  </div>
}

export function ResultCompanion({ petId, points, gained, animate, outfit = 'natural' }: { petId: ActivePetId; points: number; gained: number; animate: boolean; outfit?: OutfitId }) {
  const pet = PETS.find((entry) => entry.id === petId)!, growth = growthStage(points)
  return <div className="result-companion"><CompanionSprite petId={petId} pose={gained ? 'cheer' : 'idle'} stage={growth.stage} animate={animate} outfit={outfit} />
    <p>{pet.name}{gained ? ` 成长 +${gained}` : '等你下次一起练习'}<span>{growth.name} · 累计 {points} 成长</span></p></div>
}
