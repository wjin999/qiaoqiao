import { useState } from 'react'
import { Modal } from './Modal'
import { CompanionSprite, PetFreeTime } from './Companions'
import { equippedOutfit, OUTFITS, PETS, type ActivePetId, type CompanionPreferences, type OutfitId, type PetPose } from '../lib/companions'

export function Wardrobe({ preferences, points, disabled, onChange, onClose }: {
  preferences: CompanionPreferences; points: Record<ActivePetId, number>; disabled: boolean
  onChange: (next: CompanionPreferences) => Promise<boolean>; onClose: () => void
}) {
  const [pet, setPet] = useState(preferences.petId)
  const [preview, setPreview] = useState<OutfitId>(() => equippedOutfit(preferences, pet, points[pet]))
  const [pose, setPose] = useState<PetPose | 'reading'>('idle')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const worn = equippedOutfit(preferences, pet, points[pet])
  const item = OUTFITS[pet].find((entry) => entry.id === preview)!
  const locked = points[pet] < item.points
  const busy = disabled || saving
  async function equip(outfit: OutfitId) {
    if (busy) return
    setSaving(true); setMessage('')
    try {
      const saved = await onChange({ ...preferences, outfits: { ...preferences.outfits, [pet]: outfit } })
      if (saved) { setPreview(outfit); setMessage(outfit === 'natural' ? '已恢复原始造型' : '已装备，装扮已保存在本机') }
      else setMessage('未能保存，请重试。')
    } catch { setMessage('未能保存，请重试。') }
    finally { setSaving(false) }
  }
  return <Modal title="伙伴衣柜" onClose={() => { if (!saving) onClose() }}>
    <div className="wardrobe">
      <p className="wardrobe-intro">一起成长，慢慢收集。试穿不消耗成长，也不会改变陪练伙伴。</p>
      <div className="wardrobe-pets" role="group" aria-label="选择换装伙伴">
        {PETS.map((entry) => <button key={entry.id} type="button" aria-pressed={pet === entry.id} disabled={busy} onClick={() => {
          setPet(entry.id); setPreview(equippedOutfit(preferences, entry.id, points[entry.id])); setMessage('')
        }}>{entry.name} · {entry.id === 'golden' ? '金毛' : '猫猫'}<small>{points[entry.id]} 成长</small></button>)}
      </div>
      <div className="wardrobe-stage">
        <div className="wardrobe-slots">
          <span className="equipment-slot" aria-disabled="true">头饰<small>待开放</small></span>
          <span className="equipment-slot equipped">上衣<small>{OUTFITS[pet].find((entry) => entry.id === worn)!.name}</small></span>
        </div>
        <div className="wardrobe-preview">{pose === 'reading' ? <PetFreeTime key={`${pet}:${preview}`} petId={pet} outfit={preview} animate={preferences.animations} /> : <CompanionSprite petId={pet} outfit={preview} pose={pose} />}<span>{preview === worn ? '当前装扮' : locked ? '未解锁 · 试穿中' : '试穿中'}</span></div>
        <div className="wardrobe-slots">
          <span className="equipment-slot" aria-disabled="true">颈饰<small>待开放</small></span>
          <span className="equipment-slot" aria-disabled="true">背饰<small>待开放</small></span>
        </div>
      </div>
      <div className="wardrobe-poses" role="group" aria-label="预览动作">{(['idle', 'typing', 'cheer', 'reading'] as const).map((value, index) => <button key={value} type="button" aria-pressed={pose === value} onClick={() => setPose(value)}>{['待机', '打字', '庆祝', '读书'][index]}</button>)}</div>
      <div className="wardrobe-inventory" role="group" aria-label="上衣衣柜">
        {OUTFITS[pet].map((entry) => <button key={entry.id} type="button" aria-pressed={preview === entry.id} onClick={() => { setPreview(entry.id); setMessage('') }} disabled={busy}>
          <CompanionSprite petId={pet} outfit={entry.id} /><strong>{entry.name}</strong><small>{entry.id === worn ? '已装备' : points[pet] >= entry.points ? '已解锁' : `${entry.points} 成长解锁`}</small>
        </button>)}
      </div>
      <div className="wardrobe-item"><strong>{item.name}</strong><p>{locked ? `再积累 ${item.points - points[pet]} 成长即可解锁。现在也可以试穿看看。` : '已解锁。装备后，练习、庆祝和读书都会穿上这套衣服。'}</p></div>
      <div className="wardrobe-actions">
        <button type="button" disabled={busy || worn === 'natural'} onClick={() => void equip('natural')}>卸下上衣</button>
        <button className="primary-button" type="button" disabled={busy || locked || preview === worn} onClick={() => void equip(preview)}>{saving ? '保存中…' : locked ? `${item.points} 成长解锁` : preview === worn ? '已装备' : '装备这套'}</button>
      </div>
      <p className="wardrobe-status" role="status">{message}</p>
    </div>
  </Modal>
}
