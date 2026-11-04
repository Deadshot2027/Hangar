// Hangar's motion: the springs of QuantApp's trail Map (trailView.js), shared.
//
// Things move on springs, not on fixed curves, so a motion that is cut off
// mid-way (a second click, an arrow key held down) carries its speed into the
// next one instead of starting again. A spring is a response (seconds for one
// swing) and a damping (1 settles without overshoot; below 1 overshoots a
// little, which is what makes it feel liquid). One shared ticker runs only
// while something moves; under reduced motion everything is simply there.
import { useLayoutEffect, useRef, type RefObject } from 'react'

export interface Spring {
  x: number
  v: number
}

export const spring = (x = 0): Spring => ({ x, v: 0 })

/** The trail's springs, by job. [response s, damping] */
export const SPRINGS = {
  /** a pill gliding to a new place: quick, a touch of overshoot */
  glide: [0.36, 0.76],
  /** the leading edge of a stretching pill: faster than the rest of it */
  lead: [0.2, 0.82],
  /** a panel growing out of the button that opened it */
  grow: [0.42, 0.84],
  /** going away: fast, no bounce */
  shrink: [0.24, 1],
  /** a bead widening into a toast */
  bead: [0.34, 0.78]
} as const

export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** One step of a damped spring toward `to` (the trail's integrator, four sub-steps). */
export function step(s: Spring, to: number, dt: number, [resp, z]: readonly [number, number]): void {
  if (dt >= 0.5) {
    // wake() under reduced motion: land on the target.
    s.x = to
    s.v = 0
    return
  }
  const w = (2 * Math.PI) / resp
  const h = dt / 4
  for (let k = 0; k < 4; k++) {
    const a = -w * w * (s.x - to) - 2 * z * w * s.v
    s.v += a * h
    s.x += s.v * h
  }
}

/** Is the spring at rest on its target? `ex` in the spring's own units. */
export const still = (s: Spring, to: number, ex = 0.3) => Math.abs(s.x - to) < ex && Math.abs(s.v) < ex * 4

const ticking = new Set<(dt: number) => boolean>()
let running = false
let last = 0
function loop(now: number) {
  const dt = Math.min(Math.max((now - last) / 1000, 0), 1 / 30) || 1 / 60
  last = now
  for (const f of [...ticking]) {
    let busy = false
    try {
      busy = f(dt)
    } catch (e) {
      console.error(e)
    }
    if (!busy) ticking.delete(f)
  }
  if (ticking.size) requestAnimationFrame(loop)
  else running = false
}

/** Run `f` every frame until it returns false. Reduced motion: it settles at once. */
export function wake(f: (dt: number) => boolean): void {
  if (reducedMotion()) {
    ticking.delete(f)
    let n = 0
    while (f(1) && n++ < 3) {
      /* a big step lands everything on its target */
    }
    return
  }
  ticking.add(f)
  if (running) return
  running = true
  last = performance.now()
  requestAnimationFrame(loop)
}

export const unwake = (f: (dt: number) => boolean) => void ticking.delete(f)

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const px = (v: number) => `${Math.round(v * 100) / 100}px`

/**
 * A pill that glides to whichever child is selected, and stretches like a drop
 * of liquid on the way: the edge in front moves first and the one behind
 * catches up, and the pill thins a little while it is long. Put one
 * `<span className="glide" />` first inside the container; the container is
 * position: relative (the items' offsetParent).
 *
 * hover: follow the pointer instead (menus), and fade out when it leaves.
 */
export function useGlide(container: RefObject<HTMLElement | null>, opts: { selector: string; axis?: 'x' | 'y'; hover?: boolean; squash?: boolean }) {
  const st = useRef({
    l: spring(),
    r: spring(),
    t: spring(),
    b: spring(),
    o: spring(),
    to: { l: 0, r: 0, t: 0, b: 0, o: 0 },
    shown: false,
    tick: null as null | ((dt: number) => boolean),
    hoverEl: null as HTMLElement | null
  })
  const { selector, axis = 'x', hover = false, squash = true } = opts

  useLayoutEffect(() => {
    const root = container.current
    const pill = root?.querySelector<HTMLElement>(':scope > .glide')
    if (!root || !pill) return
    const s = st.current

    const render = () => {
      const w = Math.max(0, s.r.x - s.l.x)
      const h = Math.max(0, s.b.x - s.t.x)
      const tw = s.to.r - s.to.l
      const th = s.to.b - s.to.t
      // While the pill is longer than it will be, it gets a little thinner (it keeps its volume).
      let dw = 0
      let dh = 0
      if (squash) {
        if (axis === 'x' && tw > 0) dh = h * 0.22 * clamp(w / tw - 1, 0, 1)
        if (axis === 'y' && th > 0) dw = w * 0.1 * clamp(h / th - 1, 0, 1)
      }
      pill.style.transform = `translate3d(${px(s.l.x + dw / 2)}, ${px(s.t.x + dh / 2)}, 0)`
      pill.style.width = px(w - dw)
      pill.style.height = px(h - dh)
      pill.style.opacity = String(clamp(s.o.x, 0, 1))
    }

    const tick =
      s.tick ||
      ((dt: number) => {
        const to = s.to
        // The edge the pill moves toward leads; the other one follows.
        const right = to.l > s.l.x
        const down = to.t > s.t.x
        step(s.l, to.l, dt, axis === 'x' && !right ? SPRINGS.lead : SPRINGS.glide)
        step(s.r, to.r, dt, axis === 'x' && right ? SPRINGS.lead : SPRINGS.glide)
        step(s.t, to.t, dt, axis === 'y' && !down ? SPRINGS.lead : SPRINGS.glide)
        step(s.b, to.b, dt, axis === 'y' && down ? SPRINGS.lead : SPRINGS.glide)
        step(s.o, to.o, dt, SPRINGS.shrink)
        const done = still(s.l, to.l) && still(s.r, to.r) && still(s.t, to.t) && still(s.b, to.b) && still(s.o, to.o, 0.01)
        if (done) {
          s.l = spring(to.l)
          s.r = spring(to.r)
          s.t = spring(to.t)
          s.b = spring(to.b)
          s.o = spring(to.o)
        }
        render()
        return !done
      })
    s.tick = tick

    const place = (animate: boolean) => {
      const el = hover ? s.hoverEl : root.querySelector<HTMLElement>(selector)
      if (!el || !root.contains(el) || el.offsetParent !== root) {
        if (s.to.o !== 0) {
          s.to.o = 0
          wake(tick)
        }
        return
      }
      const to = { l: el.offsetLeft, r: el.offsetLeft + el.offsetWidth, t: el.offsetTop, b: el.offsetTop + el.offsetHeight, o: 1 }
      const same = to.l === s.to.l && to.r === s.to.r && to.t === s.to.t && to.b === s.to.b && s.to.o === 1
      if (same) return
      const appear = !s.shown || s.o.x < 0.05
      s.to = to
      if (!animate || appear) {
        // First time, or back after fading out: start where it lands (a hover pill fades in place).
        s.l = spring(to.l)
        s.r = spring(to.r)
        s.t = spring(to.t)
        s.b = spring(to.b)
        if (!animate) s.o = spring(1)
        s.shown = true
        render()
        if (animate) wake(tick)
        return
      }
      wake(tick)
    }

    place(s.shown)

    const ro = new ResizeObserver(() => place(false))
    ro.observe(root)
    if (!hover) return () => ro.disconnect()

    const over = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(selector)
      if (!el || !root.contains(el) || (el as HTMLButtonElement).disabled) return
      s.hoverEl = el
      place(true)
    }
    const leave = () => {
      s.hoverEl = null
      place(true)
    }
    root.addEventListener('pointerover', over)
    root.addEventListener('pointerleave', leave)
    return () => {
      ro.disconnect()
      root.removeEventListener('pointerover', over)
      root.removeEventListener('pointerleave', leave)
    }
  })

  useLayoutEffect(() => {
    const s = st.current
    return () => {
      if (s.tick) unwake(s.tick)
    }
  }, [])
}

export interface Box {
  l: number
  t: number
  w: number
  h: number
  r: number
}

export const lerpBox = (a: Box, b: Box, k: number): Box => ({ l: a.l + (b.l - a.l) * k, t: a.t + (b.t - a.t) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k, r: a.r + (b.r - a.r) * k })

export function placeBox(el: HTMLElement, b: Box) {
  el.style.transform = `translate3d(${px(b.l)}, ${px(b.t)}, 0)`
  el.style.width = px(Math.max(0, b.w))
  el.style.height = px(Math.max(0, b.h))
  el.style.borderRadius = px(clamp(b.r, 0, Math.min(b.w, b.h) / 2))
}
