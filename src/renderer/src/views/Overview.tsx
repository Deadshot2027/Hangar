import { useState } from 'react'
import { GitCommitHorizontal, Link2, Plus, X } from 'lucide-react'
import type { Project } from '@shared/types'
import { api, errMsg } from '../api'
import { useToast } from '../components/ui'
import { useApp } from '../state'
import { launchLabel, plural, shortAgo, tildify, useAsync } from '../util'
import { CreateRepoButton } from './Repository'

export function Overview({ project }: { project: Project }) {
  const { statuses, home, go, refresh } = useApp()
  const toast = useToast()
  const commits = useAsync(() => (project.isGit ? api.gitLog(project.id, 8) : Promise.resolve([])), [project.id, project.isGit, statuses[project.id]?.changes.length])
  const st = statuses[project.id]
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')

  const saveLinks = async (links: Project['links']) => {
    try {
      await api.updateProject(project.id, { links })
      await refresh()
    } catch (e) {
      toast(errMsg(e), false)
    }
  }
  const addLink = async () => {
    const u = url.trim()
    if (!u) return
    const full = /^https?:\/\//i.test(u) ? u : `https://${u}`
    await saveLinks([...project.links, { label: label.trim() || new URL(full).hostname, url: full }])
    setAdding(false)
    setLabel('')
    setUrl('')
  }
  const links = [...(project.remote ? [{ label: 'Repository', url: project.remote.url, fixed: true }] : []), ...project.links.map((l) => ({ ...l, fixed: false }))]

  return (
    <div className="cols">
      <div className="col-main">
        <section className="panel">
          <div className="panel-h">
            <h2>Recent activity</h2>
            {commits.data && commits.data.length > 0 && <span className="count">{commits.data.length}</span>}
          </div>
          {!project.codePath || !project.codeExists ? (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>No code folder yet. Notes and assets still work.</p>
          ) : !project.isGit ? (
            <div className="empty" style={{ padding: 22 }}>
              <h3>Not a git repo yet</h3>
              <p>Put it on GitHub to see its history here and manage its files.</p>
              <CreateRepoButton project={project} />
            </div>
          ) : commits.data && commits.data.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>No commits yet.</p>
          ) : (
            <ul className="list">
              {(commits.data || []).map((c) => (
                <li key={c.sha} className="row" style={{ gap: 12, padding: '8px 0' }}>
                  <GitCommitHorizontal size={14} className="muted" style={{ flex: 'none' }} />
                  <span className="grow ellipsis" style={{ fontSize: 12.5 }}>{c.message}</span>
                  <span className="mono muted" style={{ fontSize: 11 }}>{c.sha}</span>
                  <span className="muted" style={{ flex: '0 0 64px', textAlign: 'right', fontSize: 11.5 }}>{shortAgo(c.when)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-h">
            <h2>Links</h2>
            <span className="count grow">{links.length || ''}</span>
            <button type="button" className="text-btn" onClick={() => setAdding(true)}>
              <Plus size={12} /> Add link
            </button>
          </div>
          {links.length > 0 && (
            <ul className="list" style={{ margin: '0 -8px' }}>
              {links.map((l, i) => (
                <li key={l.url + i} className="row" style={{ gap: 4 }}>
                  <button type="button" className="list-row" style={{ minHeight: 34, padding: '0 8px', borderRadius: 6 }} onClick={() => api.openUrl(l.url)}>
                    <Link2 size={14} className="muted" style={{ flex: 'none' }} />
                    <span style={{ fontWeight: 500, fontSize: 12.5, color: 'var(--tx)' }}>{l.label}</span>
                    <span className="grow ellipsis mono muted" style={{ fontSize: 11.5 }}>{l.url.replace(/^https?:\/\//, '')}</span>
                  </button>
                  {!l.fixed && (
                    <button type="button" className="icon-btn" aria-label={`Remove ${l.label}`} onClick={() => saveLinks(project.links.filter((x) => x.url !== l.url || x.label !== l.label))}>
                      <X size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {links.length === 0 && !adding && <p className="muted" style={{ margin: 0, fontSize: 12 }}>No links yet. Add the live site, a store page or any dashboard.</p>}
          {adding && (
            <form
              className="row wrap"
              style={{ marginTop: 8 }}
              onSubmit={(e) => {
                e.preventDefault()
                void addLink()
              }}
            >
              <input className="input" style={{ flex: '0 1 160px' }} placeholder="Label" aria-label="Link label" value={label} onChange={(e) => setLabel(e.target.value)} />
              <input className="input grow" placeholder="https://…" aria-label="Link address" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
              <button type="submit" className="btn pri tall">Add</button>
              <button type="button" className="btn tall" onClick={() => setAdding(false)}>Cancel</button>
            </form>
          )}
        </section>
      </div>

      <section className="col-side panel" aria-label="Project details" style={{ paddingBottom: 8, gap: 0 }}>
        <div className="panel-h" style={{ marginBottom: 4 }}>
          <h2>Details</h2>
        </div>
        <div className="kv">
          <span>Folder</span>
          <button type="button" className="text-btn mono ellipsis" style={{ fontSize: 11.5, color: 'var(--tx)' }} onClick={() => api.openIn(project.id, 'finder')} title="Show in Finder">
            {tildify(project.codePath || project.home, home)}
          </button>
        </div>
        <div className="kv">
          <span>Launch</span>
          <button type="button" className="text-btn mono ellipsis" style={{ fontSize: 11.5, color: project.launch.kind === 'none' ? 'var(--tx3)' : 'var(--tx)' }} onClick={() => go({ kind: 'project', id: project.id, tab: 'settings' })}>
            {launchLabel(project)}
          </button>
        </div>
        <div className="kv">
          <span>Preview</span>
          <span className="mono ellipsis" style={{ fontSize: 11.5, color: project.preview.command ? 'var(--tx)' : 'var(--tx3)' }}>{project.preview.command || 'Not set'}</span>
        </div>
        {project.isGit && (
          <>
            <div className="kv">
              <span>Repository</span>
              <span className="mono ellipsis" style={{ fontSize: 11.5 }}>{project.remote ? project.remote.fullName : 'Local only'}{st ? ` · ${st.branch}` : ''}</span>
            </div>
            <div className="kv">
              <span>Changes</span>
              {st && st.changes.length > 0 ? (
                <button type="button" className="text-btn" style={{ color: 'var(--acc-text)', fontSize: 12.5 }} onClick={() => go({ kind: 'project', id: project.id, tab: 'repo' })}>
                  {plural(st.changes.length, 'uncommitted file')}
                </button>
              ) : (
                <span style={{ fontSize: 12.5 }}>Clean</span>
              )}
            </div>
          </>
        )}
        <div className="kv">
          <span>Tags</span>
          {project.tags.length ? (
            <span className="row wrap" style={{ gap: 6 }}>
              {project.tags.map((t) => (
                <span key={t} className="chip" style={{ height: 20 }}>{t}</span>
              ))}
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 12.5 }}>None</span>
          )}
        </div>
      </section>
    </div>
  )
}
