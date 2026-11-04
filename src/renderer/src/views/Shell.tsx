import { useCallback, useEffect, useState } from 'react'
import { Asterisk, ChevronDown, Code2, ExternalLink, Folder, LayoutGrid, Play, Plus, Search, SlidersHorizontal, SquareArrowOutUpRight, Terminal } from 'lucide-react'
import type { OpenTarget, Project } from '@shared/types'
import { api, errMsg } from '../api'
import { StatusIcon, useDismiss, useToast } from '../components/ui'
import { useApp } from '../state'
import { cx, plural } from '../util'

export function Sidebar() {
  const { projects, route, go, openAdd, openSettings, statuses, live, env } = useApp()
  const isHome = route.kind === 'home'
  return (
    <nav className="side" aria-label="Sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">H</span>
        <span className="brand-name">Hangar</span>
      </div>
      <button type="button" className={cx('nav-item', isHome && 'on')} aria-current={isHome ? 'page' : undefined} onClick={() => go({ kind: 'home' })}>
        <LayoutGrid size={16} />
        <span className="grow">All projects</span>
        <span className="key mono">⌘1</span>
        <span className="nav-count">{projects.length}</span>
      </button>
      <div className="side-label">
        <span>Projects</span>
        <button type="button" className="icon-btn" aria-label="Add project" title="Add project  ⌘N" onClick={() => openAdd()}>
          <Plus size={14} />
        </button>
      </div>
      {projects.map((p) => {
        const on = route.kind === 'project' && route.id === p.id
        const dirty = (statuses[p.id]?.changes.length ?? 0) > 0
        return (
          <button key={p.id} type="button" className={cx('nav-item', on && 'on')} aria-current={on ? 'page' : undefined} onClick={() => go({ kind: 'project', id: p.id, tab: 'overview' })}>
            <span className="nav-icon" style={{ display: 'flex' }}>
              <StatusIcon status={p.status} size={16} />
            </span>
            <span className="grow ellipsis">{p.name}</span>
            {live?.id === p.id && <Play size={9} fill="currentColor" style={{ color: 'var(--acc-text)' }} aria-label="Preview live" />}
            {dirty && <span className="nav-dot" aria-label="Uncommitted changes" />}
          </button>
        )
      })}
      <button type="button" className="nav-item" onClick={() => openAdd()}>
        <Plus size={16} />
        <span>Add project</span>
      </button>
      <div className="side-foot">
        <button type="button" className="nav-item grow" style={{ height: 36, paddingLeft: 7 }} onClick={openSettings} title={env?.gh.user ? `Signed in to GitHub as ${env.gh.user}` : 'GitHub not connected'}>
          <span className="avatar" aria-hidden="true">{(env?.gh.user || '?').slice(0, 1).toUpperCase()}</span>
          <span className="grow ellipsis dim">{env?.gh.user || 'Not signed in'}</span>
        </button>
        <button type="button" className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Settings" title="Settings" onClick={openSettings}>
          <SlidersHorizontal size={16} />
        </button>
      </div>
    </nav>
  )
}

const OPEN_ITEMS: { target: OpenTarget; label: (editor: string) => string; icon: typeof Code2 }[] = [
  { target: 'claude', label: () => 'Claude Code', icon: Asterisk },
  { target: 'editor', label: (e) => (e === 'cursor' ? 'Cursor' : 'VS Code'), icon: Code2 },
  { target: 'terminal', label: () => 'Terminal', icon: Terminal },
  { target: 'finder', label: () => 'Finder', icon: Folder },
  { target: 'github', label: () => 'GitHub', icon: ExternalLink }
]

export function OpenInMenu({ project }: { project: Project }) {
  const { settings } = useApp()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useDismiss<HTMLDivElement>(open, close)
  const run = async (target: OpenTarget) => {
    setOpen(false)
    try {
      const r = await api.openIn(project.id, target)
      toast(r.message, r.ok)
    } catch (e) {
      toast(errMsg(e), false)
    }
  }
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Open in <ChevronDown size={12} className="muted" />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Open in">
          {OPEN_ITEMS.map(({ target, label, icon: Icon }) => (
            <button key={target} type="button" role="menuitem" className="menu-item" disabled={target === 'github' && !project.remote} onClick={() => run(target)}>
              <Icon size={14} />
              <span>{label(settings.editor)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Opens the real, finished thing: the installed app, the live site, or a command. */
export function LaunchButton({ project }: { project: Project }) {
  const { go } = useApp()
  const toast = useToast()
  const launch = async () => {
    try {
      const r = await api.launch(project.id)
      toast(r.message, r.ok)
      if (!r.ok && project.launch.kind === 'none') go({ kind: 'project', id: project.id, tab: 'settings' })
    } catch (e) {
      toast(errMsg(e), false)
    }
  }
  return (
    <button type="button" className="btn pri" onClick={launch} title={project.launch.kind === 'none' ? 'Choose what Launch opens' : 'Launch  ⌘L'}>
      <SquareArrowOutUpRight size={12} strokeWidth={2.2} />
      Launch
    </button>
  )
}

export function TopBar({ project }: { project?: Project }) {
  const { go, openAdd, openPalette } = useApp()
  return (
    <header className="topbar">
      <div className="crumb">
        {project ? (
          <>
            <button type="button" className="text-btn" style={{ fontSize: 14, fontWeight: 500 }} onClick={() => go({ kind: 'home' })}>
              Projects
            </button>
            <span className="sep" aria-hidden="true">/</span>
            <span className="ellipsis">{project.name}</span>
          </>
        ) : (
          <span>All projects</span>
        )}
      </div>
      <div className="row">
        {project ? (
          <OpenInMenu project={project} />
        ) : (
          <button type="button" className="btn pri" onClick={() => openAdd()}>
            <Plus size={14} strokeWidth={2.2} />
            Add project
          </button>
        )}
        <button type="button" className="btn icon" aria-label="Search projects" title="Search  ⌘K" onClick={openPalette}>
          <Search size={14} />
        </button>
      </div>
    </header>
  )
}

export function StatusBar({ project }: { project?: Project }) {
  const { env, statuses, live, go } = useApp()
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [])
  const st = project ? statuses[project.id] : undefined
  const n = st?.changes.length ?? 0
  const liveHere = project && live?.id === project.id
  return (
    <footer className="statusbar" aria-label="Status">
      <span className="row" style={{ gap: 6 }}>
        <span className={cx('dot', !env?.gh.loggedIn && 'off')} aria-hidden="true" />
        {env ? (env.gh.loggedIn ? 'GitHub connected' : env.gh.installed ? 'GitHub CLI not signed in' : 'GitHub CLI not installed') : 'Checking GitHub…'}
      </span>
      {project?.isGit && st && <span className="mono">{(project.remote?.name || project.id) + ' · ' + st.branch}{st.ahead ? ` ↑${st.ahead}` : ''}{st.behind ? ` ↓${st.behind}` : ''}</span>}
      <span className="grow" />
      {liveHere && (
        <span className="row dim" style={{ gap: 5 }}>
          <Play size={8} fill="currentColor" style={{ color: 'var(--acc-text)' }} />
          Preview {live?.url ? `live · ${live.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : 'starting'}
        </span>
      )}
      {project && n > 0 && (
        <button type="button" style={{ color: 'var(--acc-text)', fontSize: 11, height: '100%' }} onClick={() => go({ kind: 'project', id: project.id, tab: 'repo' })}>
          {plural(n, 'uncommitted change')}
        </button>
      )}
      <span className="mono">{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </footer>
  )
}
