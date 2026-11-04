import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Settings } from '@shared/types'
import { expandHome } from './paths'

export function defaultSettings(): Settings {
  return {
    vault: process.env.HANGAR_VAULT || join(homedir(), 'Hangar'),
    accent: 'mono',
    theme: 'system',
    editor: 'vscode',
    dismissedFound: []
  }
}

const file = (dir: string) => join(dir, 'settings.json')

export function loadSettings(dir: string): Settings {
  const d = defaultSettings()
  try {
    if (!existsSync(file(dir))) return d
    const raw = JSON.parse(readFileSync(file(dir), 'utf8')) as Partial<Settings>
    const merged = { ...d, ...raw }
    if (process.env.HANGAR_VAULT) merged.vault = process.env.HANGAR_VAULT
    merged.vault = expandHome(merged.vault)
    return merged
  } catch {
    return d
  }
}

export function saveSettings(dir: string, patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(dir), ...patch }
  if (patch.vault) next.vault = expandHome(patch.vault)
  mkdirSync(dir, { recursive: true })
  writeFileSync(file(dir), JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}
