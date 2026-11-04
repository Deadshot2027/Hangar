import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import type { OpenTarget, Project } from '@shared/types'
import { api, errMsg } from '../api'
import { STATUS_LABEL } from '../components/ui'
import { useApp } from '../state'
import { cx } from '../util'

type ActionId = 'page' | OpenTarget | 'launch'
interface Action {
  id: ActionId
  label: string
  keys: string
}

const PROJECT_ACTIONS = (inApp: boolean, editor: string): Action[] => [
  ...(inApp ? [{ id: 'page' as const, label: 'Open project', keys: '↵' }] : []),
  { id: 'claude', label: 'Open in Claude Code', keys: inApp ? '⌘ ↵' : '↵' },
  { id: 'editor', label: `Open in ${editor === 'cursor' ? 'Cursor' : 'VS Code'}`, keys: inApp ? '' : '⌘ ↵' },
  { id: 'launch', label: 'Launch', keys: '⌘ L' },
  { id: 'terminal', label: 'Open in Terminal', keys: '' },
  { id: 'finder', label: 'Show in Finder', keys: '' },
  { id: 'github', label: 'Open on GitHub', keys: '' },
  ...(!inApp ? [{ id: 'page' as const, label: 'Open in Hangar', keys: '⌘ O' }] : [])
]

interface CoreProps {
  projects: Project[]
  inApp: boolean
  editor: string
  onClose: () => void
  onOpenPage: (id: string) => void
  onAddProject: () => void
  focusSignal?: number
}

/** The Raycast-style search: shared by the ⌥Space window and the ⌘K palette. */
export function LauncherCore({ projects, inApp, editor, onClose, onOpenPage, onAddProject, focusSignal }: CoreProps) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQ('')
    setIdx(0)
    setActionsOpen(false)
    setNote(null)
    input.current?.focus()
  }, [focusSignal])

  const needle = q.trim().toLowerCase()
  const items = useMemo(() => {
    const ps = projects
      .filter((p) => !needle || [p.name, p.description, p.id, ...p.tags].some((t) => t.toLowerCase().includes(needle)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const commands = 'add project new clone'.includes(needle) || !needle ? [{ kind: 'add' as const }] : []
    return [...ps.map((p) => ({ kind: 'project' as const, p })), ...commands]
  }, [projects, needle])
  const sel = items[Math.min(idx, items.length - 1)]
  const selProject = sel?.kind === 'project' ? sel.p : null
  const actions = selProject ? PROJECT_ACTIONS(inApp, editor).filter((a) => a.id !== 'github' || selProject.remote) : [{ id: 'page' as ActionId, label: 'Add project', keys: '↵' }]

  useEffect(() => {
    list.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const run = useCallback(
    async (id: ActionId) => {
      setActionsOpen(false)
      if (!selProject) {
        onAddProject()
        return
      }
      if (id === 'page') return onOpenPage(selProject.id)
      try {
        const r = id === 'launch' ? await api.launch(selProject.id) : await api.openIn(selProject.id, id)
        if (r.ok) onClose()
        else setNote({ text: r.message, ok: false })
      } catch (e) {
        setNote({ text: errMsg(e), ok: false })
      }
    },
    [selProject, onAddProject, onOpenPage, onClose]
  )

  const onKey = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIdx((i) => (items.length ? (Math.min(i, items.length - 1) + 1) % items.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIdx((i) => (items.length ? (Math.min(i, items.length - 1) - 1 + items.length) % items.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!selProject) return void run('page')
      if (mod) return void run(inApp ? 'claude' : 'editor')
      return void run(inApp ? 'page' : 'claude')
    } else if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      e.stopPropagation()
      setActionsOpen((o) => !o)
    } else if (mod && e.key.toLowerCase() === 'l') {
      e.preventDefault()
      void run('launch')
    } else if (mod && e.key.toLowerCase() === 'o' && !inApp) {
      e.preventDefault()
      void run('page')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (actionsOpen) setActionsOpen(false)
      else if (q) setQ('')
      else onClose()
    }
  }

  return (
    <div className="launcher" onKeyDown={onKey}>
      <div className="launcher-search">
        <Search size={18} className="muted" />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setIdx(0)
            setNote(null)
          }}
          placeholder="Search projects…"
          aria-label="Search projects"
          autoFocus
        />
        <span className="chip">↑↓ move · ↵ {inApp ? 'open' : 'Claude Code'}</span>
      </div>
      <div className="launcher-list" ref={list} role="listbox" aria-label="Projects">
        {items.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: '60px 20px' }}>No projects match “{q}”.</p>}
        {items.some((i) => i.kind === 'project') && <div className="subhead" style={{ padding: '8px 10px 4px', margin: 0 }}>Projects</div>}
        {items.map((it, i) => {
          const on = i === Math.min(idx, items.length - 1)
          if (it.kind === 'add') {
            return (
              <div key="add">
                <div className="subhead" style={{ padding: '12px 10px 4px', margin: 0 }}>Commands</div>
                <button type="button" role="option" aria-selected={on} data-on={on} className={cx('launcher-row', on && 'on')} onMouseMove={() => setIdx(i)} onClick={() => onAddProject()}>
                  <span className="glyph"><Plus size={13} /></span>
                  <span style={{ fontWeight: 500 }}>Add project</span>
                  <span className="grow ellipsis muted">From GitHub, a folder on this Mac, or new</span>
                </button>
              </div>
            )
          }
          const p = it.p
          return (
            <button key={p.id} type="button" role="option" aria-selected={on} data-on={on} className={cx('launcher-row', on && 'on')} onMouseMove={() => setIdx(i)} onClick={() => run(inApp ? 'page' : 'claude')}>
              <span className="glyph" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
              <span style={{ fontWeight: 500, flex: 'none' }}>{p.name}</span>
              <span className="grow ellipsis" style={{ color: on ? 'var(--tx2)' : 'var(--tx3)' }}>{p.description}</span>
              <span style={{ fontSize: 12, color: on ? 'var(--tx2)' : 'var(--tx3)' }}>{STATUS_LABEL[p.status]}</span>
            </button>
          )
        })}
      </div>
      <div className="launcher-foot">
        <span className="brand-mark" style={{ width: 16, height: 16, fontSize: 9, borderRadius: 4 }} aria-hidden="true">H</span>
        <span className="grow ellipsis" style={{ fontSize: 12, color: note && !note.ok ? 'var(--danger)' : 'var(--tx2)' }} role="status">
          {note?.text || (selProject ? selProject.codePath || selProject.home : 'Type to search')}
        </span>
        <button type="button" className="btn" style={{ border: 0, background: 'none' }} onClick={() => run(selProject ? (inApp ? 'page' : 'claude') : 'page')}>
          {actions[0]?.label} <span className="kbd">↵</span>
        </button>
        <button type="button" className="btn" style={{ border: 0, background: 'none' }} aria-expanded={actionsOpen} onClick={() => setActionsOpen((o) => !o)}>
          Actions <span className="kbd">⌘ K</span>
        </button>
      </div>
      {actionsOpen && (
        <div className="launcher-actions" role="menu">
          <div className="menu-label">{selProject?.name || 'Commands'}</div>
          {actions.map((a) => (
            <button key={a.id + a.label} type="button" role="menuitem" className="menu-item" onClick={() => run(a.id)}>
              <span className="grow">{a.label}</span>
              {a.keys && <span className="kbd">{a.keys}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** ⌘K inside the main window. */
export function Palette({ onClose }: { onClose: () => void }) {
  const { projects, go, openAdd, settings } = useApp()
  return (
    <div className="scrim" style={{ paddingTop: 110 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette">
        <LauncherCore
          projects={projects}
          inApp
          editor={settings.editor}
          onClose={onClose}
          onOpenPage={(id) => {
            go({ kind: 'project', id, tab: 'overview' })
            onClose()
          }}
          onAddProject={() => {
            onClose()
            openAdd()
          }}
        />
      </div>
    </div>
  )
}
