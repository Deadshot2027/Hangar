import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, Check, X } from 'lucide-react'
import type { Status } from '@shared/types'
import { cx } from '../util'

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
  return (
    <div className="seg" role="group" aria-label={label}>
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('modal', size)} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null)
  const timer = useRef<number>(0)
  const show = useCallback((text: string, ok = true) => {
    window.clearTimeout(timer.current)
    setMsg({ text, ok, id: Date.now() })
    timer.current = window.setTimeout(() => setMsg(null), ok ? 3200 : 7000)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div className={cx('toast', !msg.ok && 'bad')} role="status" key={msg.id} onClick={() => setMsg(null)}>
          {msg.ok ? <Check size={14} style={{ color: 'var(--acc-text)' }} /> : <AlertCircle size={14} style={{ color: 'var(--danger)' }} />}
          <span>{msg.text}</span>
        </div>
      )}
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}
