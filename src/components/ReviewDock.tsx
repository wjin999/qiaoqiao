import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// iOS keeps the layout viewport tall while the keyboard shrinks/pans the visual
// viewport. A fixed wrapper follows the latter; the controls sit at its bottom.
export function ReviewDock({ children }: { children: ReactNode }) {
  const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 780px)').matches ?? false)
  const wrapper = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 780px)')
    if (!media) return
    const update = () => setMobile(media.matches)
    update(); media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useLayoutEffect(() => {
    if (!mobile) return
    const viewport = window.visualViewport
    const update = () => {
      const element = wrapper.current
      if (!element) return
      element.style.top = `${viewport?.offsetTop ?? 0}px`
      element.style.left = `${viewport?.offsetLeft ?? 0}px`
      element.style.width = `${viewport?.width ?? window.innerWidth}px`
      element.style.height = `${viewport?.height ?? window.innerHeight}px`
    }
    update()
    viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [mobile])
  if (!mobile) return children
  return <><div className="review-dock-space" aria-hidden="true" />{createPortal(
    <div className="review-dock" ref={wrapper}><div className="review-dock-controls">{children}</div></div>, document.body,
  )}</>
}
