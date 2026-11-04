import { createContext, useContext } from 'react'
import type { EnvInfo, GitStatus, PreviewStatus, Project, Settings } from '@shared/types'

export type Tab = 'overview' | 'preview' | 'notes' | 'repo' | 'assets' | 'settings'
export type Route = { kind: 'home' } | { kind: 'project'; id: string; tab: Tab }
export type AddTab = 'github' | 'mac' | 'new'

export interface Live {
  id: string
  url: string | null
  status: PreviewStatus
}

export interface AppState {
  env: EnvInfo | null
  settings: Settings
  projects: Project[]
  loaded: boolean
  statuses: Record<string, GitStatus>
  live: Live | null
  route: Route
  home: string
  go: (r: Route) => void
  refresh: () => Promise<void>
  refreshStatus: (id: string) => Promise<void>
  openAdd: (tab?: AddTab) => void
  openSettings: () => void
  openPalette: () => void
  saveSettings: (patch: Partial<Settings>) => Promise<void>
}

export const AppCtx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const s = useContext(AppCtx)
  if (!s) throw new Error('useApp outside the app')
  return s
}

export function useProject(id: string): Project | undefined {
  return useApp().projects.find((p) => p.id === id)
}
