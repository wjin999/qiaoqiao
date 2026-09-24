import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CompanionSprite, PetFreeTime } from '../src/components/Companions'
import { PetArtwork } from '../src/components/PetArtwork'
import { Wardrobe } from '../src/components/Wardrobe'
import { DEFAULT_COMPANION, OUTFITS, PETS, type PetPose } from '../src/lib/companions'
import '../src/styles.css'

function Preview() {
  const [pose, setPose] = useState<PetPose | 'reading'>('idle')
  const [frame, setFrame] = useState<number | null>(null)
  const [dark, setDark] = useState(false)
  const [open, setOpen] = useState(false)
  const [preferences, setPreferences] = useState(DEFAULT_COMPANION)
  return <main style={{ padding: 24 }}>
    <h1>伙伴服装检查</h1><p>独立设计预览 · 不读取或修改学习记录。模拟成长仅用于检查衣柜。</p>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
      {(['idle', 'typing', 'cheer', 'reading'] as const).map((value, i) => <button key={value} onClick={() => { setPose(value); setFrame(null) }}>{['待机', '打字', '庆祝', '读书'][i]}</button>)}
      <button onClick={() => { setPose('reading'); setFrame((frame === null ? -1 : frame) + 1 & 7) }}>逐帧 {frame ?? '—'}</button>
      <button onClick={() => setDark(!dark)}>切换背景</button><button onClick={() => setOpen(true)}>衣柜（150 成长）</button>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
      {PETS.flatMap((pet) => OUTFITS[pet.id].map((item) => <article key={`${pet.id}-${item.id}`} style={{ padding: 20, borderRadius: 16, textAlign: 'center', background: dark ? '#293133' : '#eff1e9', color: dark ? '#fff' : '#273b2b' }}>
        <h2 style={{ fontSize: 15 }}>{pet.name} · {item.name}</h2>
        {pose === 'reading' ? frame === null ? <PetFreeTime petId={pet.id} outfit={item.id} animate /> : <div style={{ height: 240 }}><PetArtwork pet={pet.id} outfit={item.id} kind="turn" frame={frame}/></div> : <CompanionSprite petId={pet.id} outfit={item.id} pose={pose}/>}
      </article>))}
    </div>
    {open && <Wardrobe preferences={preferences} points={{golden:150,tuxedo:150}} disabled={false} onChange={async (next) => { setPreferences(next); return true }} onClose={() => setOpen(false)} />}
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview/> )
