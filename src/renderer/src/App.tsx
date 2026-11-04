import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EnvInfo, GitStatus, Project, Settings } from '@shared/types'
import { api, errMsg } from './api'
import { useToast } from './components/ui'
import { AppCtx, type AddTab, type AppState, type Live, type Route } from './state'
import { homeFrom, isTypingTarget, useTheme } from './util'
import { AddProject } from './views/AddProject'
import { AppSettings } from './views/AppSettings'
import { Home } from './views/Home'
import { Palette } from './views/Launcher'
import { ProjectPage } from './views/ProjectPage'
import { Sidebar, StatusBar, TopBar } from './views/Shell'

const FALLBACK: Settings = { vault: '', accent: 'mono', theme: 'system', editor: 'vscode', dismissedFound: [] }

type Overlay = { kind: 'add'; tab: AddTab } | { kind: 'settings' } | { kind: 'palette' } | null

export default function App() {
  const toast = useToast()
  const [env, setEnv] = useState<EnvInfo | null>(null)
  const [settings, setSettings] = useState<Settings>(FALLBACK)
  const [projects, setProjects] = useState<Project[]>([])
  const [loaded, setLoaded] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, GitStatus>>({})
  const [live, setLive] = useState<Live | null>(null)
  const [route, setRoute] = useState<Route>({ kind: 'home' })
  const [overlay, setOverlay] = useState<Overlay>(null)
  useTheme(loaded ? settings : null)

  const refreshStatus = useCallback(async (id: string) => {
    try {
      const st = await api.gitStatus(id)
      setStatuses((prev) => ({ ...prev, [id]: st }))
    } catch {
      /* folder gone or not a repo */
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const list = await api.listProjects()
      setProjects(list)
      setLoaded(true)
      await Promise.all(list.filter((p) => p.isGit).map((p) => refreshStatus(p.id)))
    } catch (e) {
      toast(errMsg(e), false)
      setLoaded(true)
    }
  }, [refreshStatus, toast])

  useEffect(() => {
    api.settings().then(setSettings)
    api.env().then(setEnv)
    refresh()
    document.documentElement.classList.toggle('mac', navigator.userAgent.includes('Mac'))
  }, [refresh])

  useEffect(() => api.onProjectsChanged(() => void refresh()), [refresh])
  useEffect(() => {
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])
  useEffect(
    () =>
      api.onNavigate((t) => {
        if (t.addProject) setOverlay({ kind: 'add', tab: 'github' })
        else if (t.projectId) setRoute({ kind: 'project', id: t.projectId, tab: 'overview' })
      }),
    []
  )
  useEffect(
    () =>
      api.onPreview((e) => {
        if (e.type === 'url') setLive((l) => (l && l.id === e.id ? { ...l, url: e.url } : { id: e.id, url: e.url, status: 'running' }))
        if (e.type === 'status') {
          if (e.status === 'idle' || e.status === 'exited') setLive((l) => (l && l.id === e.id ? null : l))
          else setLive((l) => (l && l.id === e.id ? { ...l, status: e.status } : { id: e.id, url: null, status: e.status }))
        }
      }),
    []
  )

  // A project that was removed (in Hangar or in Finder) sends you home.
  useEffect(() => {
    if (loaded && route.kind === 'project' && !projects.some((p) => p.id === route.id)) setRoute({ kind: 'home' })
  }, [loaded, projects, route])

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.saveSettings(patch)
    setSettings(next)
    if (patch.vault) {
      setEnv(await api.env())
      setRoute({ kind: 'home' })
      await refresh()
    }
  }, [refresh])

  const state: AppState = useMemo(
    () => ({
      env,
      settings,
      projects,
      loaded,
      statuses,
      live,
      route,
      home: homeFrom(settings.vault),
      go: setRoute,
      refresh,
      refreshStatus,
      openAdd: (tab = 'github') => setOverlay({ kind: 'add', tab }),
      openSettings: () => setOverlay({ kind: 'settings' }),
      openPalette: () => setOverlay({ kind: 'palette' }),
      saveSettings
    }),
    [env, settings, projects, loaded, statuses, live, route, refresh, refreshStatus, saveSettings]
  )

  // Keyboard: ⌘K search, ⌘1 all projects, ⌘N add project, ⌘L launch this project.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'k') {
        e.preventDefault()
        setOverlay((o) => (o?.kind === 'palette' ? null : { kind: 'palette' }))
      } else if (isTypingTarget(e.target)) {
        return
      } else if (k === '1') {
        e.preventDefault()
        setRoute({ kind: 'home' })
      } else if (k === 'n') {
        e.preventDefault()
        setOverlay({ kind: 'add', tab: 'github' })
      } else if (k === 'l' && route.kind === 'project') {
        e.preventDefault()
        api.launch(route.id).then((r) => toast(r.message, r.ok)).catch((err) => toast(errMsg(err), false))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route, toast])

  const current = route.kind === 'project' ? projects.find((p) => p.id === route.id) : undefined

  return (
    <AppCtx.Provider value={state}>
      <div className="app">
        <div className="side-drag" />
        <Sidebar />
        <div className="main">
          <TopBar project={current} />
          <div className="content">{current && route.kind === 'project' ? <ProjectPage key={current.id} project={current} tab={route.tab} /> : <Home />}</div>
          <StatusBar project={current} />
        </div>
      </div>
      {overlay?.kind === 'add' && <AddProject initialTab={overlay.tab} onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'settings' && <AppSettings onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'palette' && <Palette onClose={() => setOverlay(null)} />}
    </AppCtx.Provider>
  )
}
