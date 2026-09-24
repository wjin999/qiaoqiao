import { useEffect, useState } from 'react'
import type { ActivePetId, OutfitId } from '../lib/companions'
import frameMetadata from '../assets/companions/frames.json'

const images = import.meta.glob<string>('../assets/companions/*.png', { eager: true, query: '?url', import: 'default' })
export type SheetKind = 'poses' | 'reading' | 'turn'
function sheetName(pet: ActivePetId, outfit: OutfitId, kind: SheetKind) {
  return outfit === 'natural' ? (kind === 'poses' ? (pet === 'golden' ? 'golden-retriever' : 'tuxedo-cat') : `${pet}-${kind}`) : `${pet}-${outfit}${kind === 'poses' ? '' : `-${kind}`}`
}

// Crop in source-image coordinates. The original pose sheets are not evenly spaced.
// A nested SVG viewport clips each frame before scaling, so neighbours cannot bleed in.
export function PetArtwork({ pet, outfit = 'natural', kind = 'poses', frame = 0, onLoad }: {
  pet: ActivePetId; outfit?: OutfitId; kind?: SheetKind; frame?: number; onLoad?: () => void
}) {
  const name = sheetName(pet, outfit, kind)
  const src = images[`../assets/companions/${name}.png`]!
  const { width, height, edges } = (frameMetadata as Record<string, { width: number; height: number; edges?: number[] }>)[name]!
  const columns = kind === 'poses' ? 3 : 4, rows = kind === 'turn' ? 2 : 1
  let x = Math.floor(frame % columns * width / columns), y = Math.floor(Math.floor(frame / columns) * height / rows)
  let w = Math.floor(width / columns), h = Math.floor(height / rows)
  if (edges) { x = edges[frame]!; w = edges[frame + 1]! - x }
  // Measured transparent gutters plus a two-pixel sampling guard at either edge.
  x += 2; y += 2; w -= 4; h -= 4
  return <span className="pet-artwork" data-outfit={outfit} data-frame={frame}>
    <img className="pet-artwork-loader" src={src} alt="" draggable="false" onLoad={onLoad} />
    <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><svg width={w} height={h} viewBox={`${x} ${y} ${w} ${h}`} overflow="hidden"><image href={src} width={width} height={height} /></svg></svg>
  </span>
}

export function TurningArtwork({ pet, outfit, playing, visible, onLoad }: {
  pet: ActivePetId; outfit: OutfitId; playing: boolean; visible: boolean; onLoad: () => void
}) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!playing) { setFrame(0); return }
    if (!visible || frame >= 7) return
    const timer = window.setTimeout(() => setFrame((value) => value + 1), frame === 0 ? 0 : 180)
    return () => window.clearTimeout(timer)
  }, [playing, visible, frame])
  return <PetArtwork pet={pet} outfit={outfit} kind="turn" frame={frame} onLoad={onLoad} />
}
