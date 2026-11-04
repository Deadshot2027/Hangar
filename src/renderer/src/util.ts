import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project, Settings } from '@shared/types'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
  if (s < 86400 * 60) return `${Math.floor(s / (86400 * 7))}w ago`
  return `${Math.floor(s / (86400 * 30))}mo ago`
}

/** git's "2 hours ago" / "3 weeks ago" / "1 year, 2 months ago" as "2h", "3w", "1y". */
export function shortAgo(rel: string): string {
  const m = rel.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?/)
  if (!m) return rel
  const unit = { second: 's', minute: 'm', hour: 'h', day: 'd', week: 'w', month: 'mo', year: 'y' }[m[2]]
  return `${m[1]}${unit}`
}

export function tildify(path: string | null | undefined, home: string): string {
  if (!path) return ''
  return home && path.startsWith(home) ? '~' + path.slice(home.length) : path
}

/** The user's home folder, worked out from the vault path (the UI has no Node). */
export function homeFrom(vault: string): string {
  const m = vault.match(/^(\/Users\/[^/]+|\/home\/[^/]+|\/root)/)
  return m ? m[1] : ''
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

export function launchLabel(p: Project): string {
  const t = p.launch.target.trim()
  if (p.launch.kind === 'none' || !t) return 'Not set'
  if (p.launch.kind === 'app') return t.split('/').pop() || t
  return t
}

/** dark/light from the setting, following the Mac when it is "system". */
export function useTheme(settings: Settings | null): void {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSystemDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  useEffect(() => {
    if (!settings) return
    const dark = settings.theme === 'system' ? systemDark : settings.theme === 'dark'
    const root = document.documentElement
    root.classList.toggle('t-dark', dark)
    root.classList.toggle('t-light', !dark)
    root.classList.toggle('a-violet', settings.accent === 'violet')
    root.classList.toggle('a-mono', settings.accent !== 'violet')
  }, [settings, systemDark])
}

/** Load something async, with reload; keeps the last value while reloading. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    let alive = true
    setLoading(true)
    fnRef
      .current()
      .then((v) => {
        if (!alive) return
        setData(v)
        setError(null)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

export function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}
