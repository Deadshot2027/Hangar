import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { SPRINGS, lerpBox, placeBox, spring, step, still, wake, type Box } from '../motion'
import { cx } from '../util'

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/**
 * A popover that grows out of the button that opened it, the way the trail's
 * "Needs a look" pill grows into its list: the glass starts as the button,
 * swells into the panel on a spring, and the contents fade in once there is
 * room for them. Closing runs it back into the button.
 */
export function Grow({ open, anchor, className, children, role, label }: { open: boolean; anchor: RefObject<HTMLElement | null>; className?: string; children: ReactNode; role?: string; label?: string }) {
  const [mounted, setMounted] = useState(open)
  const root = useRef<HTMLDivElement>(null)
  const bg = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const s = useRef({ k: spring(0), to: 0, from: null as Box | null, end: null as Box | null })

  const measure = useCallback(() => {
    const r = root.current?.getBoundingClientRect()
    const a = anchor.current?.getBoundingClientRect()
    if (!r) return
    s.current.end = { l: 0, t: 0, w: r.width, h: r.height, r: 10 }
    s.current.from = a ? { l: a.left - r.left, t: a.top - r.top, w: a.width, h: a.height, r: 6 } : { l: r.width / 2 - 12, t: 0, w: 24, h: 24, r: 12 }
  }, [anchor])

  const render = useCallback(() => {
    const { k, from, end } = s.current
    if (!bg.current || !body.current || !from || !end) return
    placeBox(bg.current, lerpBox(from, end, clamp(k.x, -0.02, 1.04)))
    const po = clamp((k.x - 0.4) / 0.45, 0, 1)
    body.current.style.opacity = String(po)
    body.current.style.transform = po < 1 ? `translateY(${((1 - po) * -5).toFixed(2)}px) scale(${(0.985 + 0.015 * po).toFixed(4)})` : ''
  }, [])

  const tick = useCallback(
    (dt: number) => {
      const st = s.current
      step(st.k, st.to, dt, st.to ? SPRINGS.grow : SPRINGS.shrink)
      const done = still(st.k, st.to, 0.002)
      if (done) st.k = spring(st.to)
      render()
      if (done && st.to === 0) setMounted(false)
      return !done
    },
    [render]
  )

  useEffect(() => {
    if (open) setMounted(true)
    else if (mounted) {
      measure()
      s.current.to = 0
      wake(tick)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!mounted || !open) return
    measure()
    s.current.to = 1
    render()
    wake(tick)
  }, [mounted, open, measure, render, tick])

  if (!mounted) return null
  return (
    <div ref={root} className={cx(className, 'grow-pop')} role={role} aria-label={label}>
      <div ref={bg} className="grow-bg" aria-hidden="true" />
      <div ref={body} className="grow-body" style={{ opacity: 0 }}>
        {children}
      </div>
    </div>
  )
}

/**
 * A dialog that springs up out of a glass scrim, and sinks back when closed.
 * Returns the close function the dialog should call (Escape, the X, a click
 * outside): it plays the way out, then calls onClose.
 */
export function usePop(panel: RefObject<HTMLElement | null>, scrim: RefObject<HTMLElement | null>, onClose: () => void) {
  const s = useRef({ k: spring(0), to: 1, closing: false })
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const render = useCallback(() => {
    const k = s.current.k.x
    const p = panel.current
    if (p) {
      p.style.opacity = String(clamp(k * 1.6, 0, 1))
      p.style.transform = k < 0.999 || k > 1.001 ? `translateY(${((1 - k) * 16).toFixed(2)}px) scale(${(0.955 + 0.045 * k).toFixed(4)})` : ''
      p.style.filter = k < 0.97 ? `blur(${((1 - clamp(k, 0, 1)) * 6).toFixed(2)}px)` : ''
    }
    if (scrim.current) scrim.current.style.opacity = String(clamp(k * 1.4, 0, 1))
  }, [panel, scrim])

  const tick = useCallback(
    (dt: number) => {
      const st = s.current
      step(st.k, st.to, dt, st.to ? SPRINGS.grow : SPRINGS.shrink)
      const done = still(st.k, st.to, 0.002) || (st.to === 0 && st.k.x < 0.02)
      if (done) st.k = spring(st.to)
      render()
      if (done && st.to === 0) closeRef.current()
      return !done
    },
    [render]
  )

  useLayoutEffect(() => {
    render()
    wake(tick)
  }, [render, tick])

  return useCallback(() => {
    if (s.current.closing) return
    s.current.closing = true
    s.current.to = 0
    wake(tick)
  }, [tick])
}

/**
 * The liquid loader: a bead that buds smaller beads off each side and takes
 * them back, joined by a liquid neck while they pull apart (an SVG "goo"
 * filter: blur, then a hard alpha edge). Small and drawn on the compositor.
 */
export function Beads({ size = 1, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg className={cx('beads', className)} width={96 * size} height={36 * size} viewBox="0 0 96 36" aria-hidden="true">
      <defs>
        <filter id={`goo${id}`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3.4" result="b" />
          <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
        </filter>
      </defs>
      <g filter={`url(#goo${id})`} fill="currentColor">
        <circle className="bead bead-c" cx="48" cy="18" r="9" />
        <circle className="bead bead-l" cx="48" cy="18" r="5.5" />
        <circle className="bead bead-r" cx="48" cy="18" r="5.5" />
        <circle className="bead bead-f" cx="48" cy="18" r="3.5" />
      </g>
    </svg>
  )
}

/** Three dots that light one after another: a button's label while it works (QuantApp's MorphButton). */
export function Dots() {
  return (
    <span className="dots" aria-hidden="true">
      <span>
        <i />
      </span>
      <span>
        <i />
      </span>
      <span>
        <i />
      </span>
    </span>
  )
}

export type Morph = 'idle' | 'busy' | 'done' | 'failed'

/**
 * Run `work` from a button whose label melts into the dots, then a tick (or
 * a red mark). The dots stay at least 400ms so they never blink.
 */
export function useMorph() {
  const [morph, setMorph] = useState<Morph>('idle')
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const run = useCallback(async <T,>(work: () => Promise<T>, ok: (r: T) => boolean = () => true): Promise<T | undefined> => {
    window.clearTimeout(timer.current)
    setMorph('busy')
    const started = performance.now()
    let result: T | undefined
    let good = false
    try {
      result = await work()
      good = ok(result)
    } catch (e) {
      good = false
      throw e
    } finally {
      const wait = Math.max(0, 400 - (performance.now() - started))
      window.setTimeout(() => {
        setMorph(good ? 'done' : 'failed')
        timer.current = window.setTimeout(() => setMorph('idle'), good ? 900 : 1400)
      }, wait)
    }
    return result
  }, [])
  return { morph, run }
}

export function MorphLabel({ morph, children }: { morph: Morph; children: ReactNode }) {
  return (
    <>
      <span className="mo-content">{children}</span>
      <span className="mo-over" aria-hidden="true">
        {morph === 'busy' && <Dots />}
        {morph === 'done' && (
          <svg className="mo-tick" width="13" height="13" viewBox="0 0 14 14">
            <path d="M3 7.4 5.9 10.2 11 4.4" />
          </svg>
        )}
        {morph === 'failed' && (
          <svg className="mo-err" width="12" height="12" viewBox="0 0 12 12">
            <path d="M3.2 3.2 8.8 8.8M8.8 3.2 3.2 8.8" />
          </svg>
        )}
      </span>
    </>
  )
}
