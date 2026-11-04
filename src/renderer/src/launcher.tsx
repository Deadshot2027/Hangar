import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Project, Settings } from '@shared/types'
import { api } from './api'
import { useTheme } from './util'
import { LauncherCore } from './views/Launcher'
import './styles.css'

/** The ⌥Space window: a floating search over every project, from anywhere on the Mac. */
function LauncherWindow() {
  const [projects, setProjects] = useState<Project[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [shown, setShown] = useState(0)
  useTheme(settings)

  useEffect(() => {
    const load = () => {
      api.listProjects().then(setProjects).catch(() => undefined)
      api.settings().then(setSettings).catch(() => undefined)
    }
    load()
    return api.onLauncherShown(() => {
      load()
      setShown((n) => n + 1)
    })
  }, [])

  return (
    <LauncherCore
      projects={projects}
      inApp={false}
      editor={settings?.editor || 'vscode'}
      focusSignal={shown}
      onClose={() => void api.launcherHide()}
      onOpenPage={(id) => void api.showMain({ projectId: id })}
      onAddProject={() => void api.showMain({ addProject: true })}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LauncherWindow />
  </StrictMode>
)
