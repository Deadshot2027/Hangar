import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, Check, X } from 'lucide-react'
import type { Status } from '@shared/types'
import { SPRINGS, spring, step, still, useGlide, wake } from '../motion'
import { cx } from '../util'
import { usePop } from './liquid'

// ---------------------------------------------------------------- status

export const STATUS_LABEL: Record<Status, string> = { idea: 'Idea', building: 'Building', live: 'Live', paused: 'Paused' }
export const STATUS_ORDER: Status[] = ['idea', 'building', 'live', 'paused']

/** Status as a shape, not a colour: dashed ring, half disc, filled check, pause bars. */
export function StatusIcon({ status, size = 14 }: { status: Status; size?: number }) {
  const common = { strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" style={{ flex: 'none' }}>
      {status === 'idea' && <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeDasharray="2 2.4" {...common} />}
      {status === 'building' && (
        <>
          <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" {...common} />
          <path d="M7 3.7A3.3 3.3 0 0 1 7 10.3Z" fill="currentColor" />
        </>
      )}
      {status === 'live' && (
        <>
          <circle cx="7" cy="7" r="5.6" fill="currentColor" stroke="currentColor" {...common} />
          <path d="M4.7 7.2 6.3 8.8 9.4 5.6" fill="none" style={{ stroke: 'var(--bg)' }} {...common} />
        </>
      )}
      {status === 'paused' && (
        <>
          <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" {...common} />
          <path d="M5.8 5.3v3.4M8.2 5.3v3.4" fill="none" stroke="currentColor" {...common} />
        </>
      )}
    </svg>
  )
}

// ---------------------------------------------------------------- segmented control

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useGlide(ref, { selector: 'button.on' })
  return (
    <div className="seg" role="group" aria-label={label} ref={ref}>
      <span className="glide" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.value} type="button" className={cx(o.value === value && 'on')} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- modal

export function Modal({ title, onClose, children, footer, size }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'sm' }) {
  const panel = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const close = usePop(panel, scrim, onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  return (
    <div className="scrim" ref={scrim} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={cx('modal', size)} role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <div className="modal-h">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
            <X size={14} />
          </button>
        </div>
        {children}
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  )
}

/** Close a popup menu when clicking anywhere else. */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

// ---------------------------------------------------------------- toast

interface ToastMsg {
  text: string
  ok: boolean
  id: number
}
const ToastCtx = createContext<(text: string, ok?: boolean) => void>(() => undefined)

/** The bead a toast starts as and melts back into. */
const BEAD = 14

/**
 * Notices arrive the way the trail's pill does: a bead pops in at the corner
 * and widens into the message; a new message reshapes the same glass; it
 * shrinks back into the bead and melts away when it is done.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null)
  const timer = useRef<number>(0)
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const s = useRef({ w: spring(BEAD), h: spring(BEAD), sc: spring(0), tw: BEAD, th: BEAD, tsc: 0, leaving: false })

  const render = useCallback(() => {
    const el = box.current
    const st = s.current
    if (!el) return
    const w = Math.max(BEAD * 0.6, st.w.x)
    const h = Math.max(BEAD * 0.6, st.h.x)
    el.style.width = `${w.toFixed(2)}px`
    el.style.height = `${h.toFixed(2)}px`
    el.style.borderRadius = `${Math.min(h / 2, 10 + (1 - Math.min(1, (w - BEAD) / 60)) * 20).toFixed(2)}px`
    el.style.transform = `scale(${Math.max(0, st.sc.x).toFixed(4)})`
    if (inner.current) inner.current.style.opacity = String(st.leaving ? 0 : clamp01((w / Math.max(st.tw, 1) - 0.62) / 0.3))
  }, [])

  const tick = useCallback(
    (dt: number) => {
      const st = s.current
      step(st.w, st.tw, dt, SPRINGS.bead)
      step(st.h, st.th, dt, SPRINGS.bead)
      // Leaving: once it is a bead again, it melts.
      if (st.leaving && st.w.x < BEAD + 6) st.tsc = 0
      step(st.sc, st.tsc, dt, st.tsc ? SPRINGS.glide : SPRINGS.shrink)
      const done = still(st.w, st.tw) && still(st.h, st.th) && still(st.sc, st.tsc, 0.004)
      render()
      if (st.leaving && st.sc.x < 0.03 && st.tsc === 0) {
        st.sc = spring(0)
        setMsg(null)
        return false
      }
      return !done
    },
    [render]
  )

  const leave = useCallback(() => {
    const st = s.current
    st.leaving = true
    st.tw = BEAD
    st.th = BEAD
    wake(tick)
  }, [tick])

  const show = useCallback(
    (text: string, ok = true) => {
      window.clearTimeout(timer.current)
      setMsg({ text, ok, id: Date.now() })
      timer.current = window.setTimeout(leave, ok ? 3200 : 7000)
    },
    [leave]
  )

  useLayoutEffect(() => {
    if (!msg || !inner.current) return
    const st = s.current
    const fresh = st.sc.x < 0.05 || st.leaving
    st.leaving = false
    st.tw = inner.current.offsetWidth
    st.th = inner.current.offsetHeight
    st.tsc = 1
    if (fresh) {
      st.w = spring(BEAD)
      st.h = spring(BEAD)
      st.sc = spring(0)
    }
    render()
    wake(tick)
  }, [msg, render, tick])

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div ref={box} className={cx('toast', !msg.ok && 'bad')} role="status" onClick={leave}>
          <div ref={inner} className="toast-in" key={msg.id}>
            {msg.ok ? <Check size={14} style={{ color: 'var(--acc-text)' }} /> : <AlertCircle size={14} style={{ color: 'var(--danger)' }} />}
            <span>{msg.text}</span>
          </div>
        </div>
      )}
    </ToastCtx.Provider>
  )
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export const useToast = () => useContext(ToastCtx)

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}
