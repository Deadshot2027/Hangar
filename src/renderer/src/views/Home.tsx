import { useEffect, useMemo, useState } from 'react'
import { Folder, Plus, X } from 'lucide-react'
import type { FoundFolder, Status } from '@shared/types'
import { api } from '../api'
import { STATUS_LABEL, StatusIcon } from '../components/ui'
import { useApp } from '../state'
import { cx, timeAgo } from '../util'

export function Home() {
  const { projects, loaded, statuses, go, openAdd, settings, saveSettings } = useApp()
  const [filter, setFilter] = useState<Status | 'all'>('all')
  const [found, setFound] = useState<FoundFolder[]>([])

  useEffect(() => {
    let alive = true
    api.discover().then((f) => alive && setFound(f)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [projects.length, settings.dismissedFound.length])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: projects.length }
    for (const p of projects) c[p.status] = (c[p.status] || 0) + 1
    return c
  }, [projects])
  const filters = (['all', 'building', 'live', 'idea', 'paused'] as const).filter((k) => k === 'all' || k === filter || counts[k])
  const rows = [...projects].filter((p) => filter === 'all' || p.status === filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const dismissFound = () => saveSettings({ dismissedFound: [...settings.dismissedFound, ...found.map((f) => f.path)] })

  if (loaded && projects.length === 0) {
    return (
      <div className="page" style={{ maxWidth: 640, margin: '0 auto', paddingTop: 80 }}>
        <div className="empty" style={{ padding: '40px 24px' }}>
          <h3 style={{ fontSize: 15 }}>Welcome to Hangar</h3>
          <p>Add your projects from GitHub, from folders already on this Mac, or start a new one. Each gets notes, files, a live preview and its GitHub repo in one place.</p>
          <button type="button" className="btn pri tall" style={{ marginTop: 6 }} onClick={() => openAdd(found.length ? 'mac' : 'github')}>
            <Plus size={14} strokeWidth={2.2} /> Add your first project
          </button>
          {found.length > 0 && <p style={{ marginTop: 4 }}>Hangar found {found.length} project folder{found.length === 1 ? '' : 's'} on this Mac already.</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="page" style={{ paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <nav className="tabs" aria-label="Filter by status">
        {filters.map((k) => (
          <button key={k} type="button" className={cx(filter === k && 'on')} aria-current={filter === k ? 'page' : undefined} onClick={() => setFilter(k)}>
            {k === 'all' ? 'All' : k === 'idea' ? 'Ideas' : STATUS_LABEL[k]}
            <span className="muted" style={{ fontSize: 11.5, fontWeight: 400 }}>{counts[k] || 0}</span>
          </button>
        ))}
      </nav>

      {found.length > 0 && (
        <div className="notice">
          <Folder size={14} style={{ color: 'var(--acc-text)', flex: 'none' }} />
          <span className="dim" style={{ flex: '1 1 260px' }}>
            {found.length === 1 ? '1 folder' : `${found.length} folders`} on this Mac look like projects but aren’t in Hangar yet:{' '}
            {found.slice(0, 4).map((f) => f.name).join(', ')}
            {found.length > 4 ? '…' : '.'}
          </span>
          <button type="button" className="btn sm" onClick={() => openAdd('mac')}>Review</button>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={dismissFound}>
            <X size={12} />
          </button>
        </div>
      )}

      <section className="frame" aria-label="Projects">
        <div className="list-head" aria-hidden="true">
          <span style={{ flex: '0 0 14px' }} />
          <span style={{ flex: '0 0 150px' }}>Name</span>
          <span style={{ flex: '1 1 220px' }}>Description</span>
          <span style={{ flex: '0 0 160px' }}>Repo</span>
          <span style={{ flex: '0 0 64px', textAlign: 'right' }}>Updated</span>
        </div>
        <ul className="list">
          {rows.map((p) => {
            const st = statuses[p.id]
            const n = st?.changes.length ?? 0
            const repo = !p.codePath ? 'No code yet' : !p.codeExists ? 'Folder missing' : !p.isGit ? 'Not a git repo' : `${st?.branch || '…'}${n ? ` · ${n} changed` : ''}${p.remote ? '' : ' · local'}`
            return (
              <li key={p.id}>
                <button type="button" className="list-row" onClick={() => go({ kind: 'project', id: p.id, tab: 'overview' })}>
                  <StatusIcon status={p.status} />
                  <span className="ellipsis" style={{ flex: '0 0 150px', fontWeight: 500, color: 'var(--tx)' }}>{p.name}</span>
                  <span className="ellipsis muted" style={{ flex: '1 1 220px' }}>{p.description || '—'}</span>
                  <span className="ellipsis mono muted" style={{ flex: '0 0 160px', fontSize: 11.5 }}>{repo}</span>
                  <span className="muted" style={{ flex: '0 0 64px', textAlign: 'right', fontSize: 12 }}>{timeAgo(p.updatedAt)}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {loaded && rows.length === 0 && <p className="muted" style={{ margin: 0, padding: '36px 20px', textAlign: 'center' }}>No projects with this status yet.</p>}
      </section>
    </div>
  )
}
