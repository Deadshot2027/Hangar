import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'

export function slugify(text: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'project'
}

/** "my-cool_app" -> "My Cool App"; names that already have capitals are kept. */
export function prettyName(folder: string): string {
  if (/[A-Z]/.test(folder) || folder.includes('.')) return folder
  return folder
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

export function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

export function tildify(p: string): string {
  const h = homedir()
  return p === h || p.startsWith(h + sep) ? '~' + p.slice(h.length) : p
}

/** Resolve a path the UI sent, refusing anything that escapes `root`. */
export function within(root: string, rel: string): string {
  const base = resolve(root)
  const abs = resolve(base, rel || '.')
  if (abs !== base && !abs.startsWith(base + sep)) throw new Error('That path is outside the project folder.')
  return abs
}

export function absoluteCode(home: string, code: string | null): string | null {
  if (!code) return null
  const expanded = expandHome(code)
  return isAbsolute(expanded) ? expanded : join(home, expanded)
}
