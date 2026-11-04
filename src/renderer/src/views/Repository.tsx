import { useCallback, useState, type DragEvent } from 'react'
import { ArrowDownToLine, Check, ChevronDown, ExternalLink, File, Folder, GitBranch, Package, Plus, Tag, Trash2, Upload } from 'lucide-react'
import type { GitStatus, Project, Release } from '@shared/types'
import { api, errMsg } from '../api'
import { Seg, Spinner, useDismiss, useToast } from '../components/ui'
import { useApp } from '../state'
import { bytes, cx, plural, shortAgo, timeAgo, useAsync } from '../util'

/** Put a project on GitHub (git init, first commit and push when needed). */
export function CreateRepoButton({ project }: { project: Project }) {
  const { env, refresh } = useApp()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [vis, setVis] = useState<'private' | 'public'>('private')
  if (env && !env.gh.loggedIn) {
    return (
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {env.gh.installed ? 'Connect GitHub first: run ' : 'Install the GitHub CLI with '}
        <code className="mono">{env.gh.installed ? 'gh auth login' : 'brew install gh'}</code>
        {env.gh.installed ? ' in Terminal.' : ', then run gh auth login.'}
      </p>
    )
  }
  return (
    <div className="row wrap" style={{ justifyContent: 'center' }}>
      <Seg label="Visibility" value={vis} onChange={setVis} options={[{ value: 'private', label: 'Private' }, { value: 'public', label: 'Public' }]} />
      <button
        type="button"
        className="btn pri"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            const r = await api.createRepo(project.id, vis)
            toast(r.message, r.ok)
            await refresh()
          } catch (e) {
            toast(errMsg(e), false)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy && <Spinner size={12} />} Create GitHub repo
      </button>
    </div>
  )
}

export function Repository({ project }: { project: Project }) {
  const [view, setView] = useState<'files' | 'releases'>('files')
  if (!project.codePath || !project.codeExists || !project.isGit) {
    return (
      <div className="empty">
        <h3>{project.codePath && project.codeExists ? 'This folder is not a git repo yet' : 'No code yet'}</h3>
        <p>Create a GitHub repo to manage files, branches and releases from here. Your folder stays where it is.</p>
        <CreateRepoButton project={project} />
      </div>
    )
  }
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Seg label="Repository view" value={view} onChange={setView} options={[{ value: 'files', label: 'Files' }, { value: 'releases', label: 'Releases' }]} />
      </div>
      {view === 'files' ? <Files project={project} /> : <Releases project={project} />}
    </>
  )
}

function ChangesBar({ project, status, onDone }: { project: Project; status: GitStatus; onDone: () => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const push = async () => {
    setBusy(true)
    try {
      const r = await api.commitPush(project.id, msg)
      toast(r.message, r.ok)
      setMsg('')
      setOpen(false)
      onDone()
    } catch (e) {
      toast(errMsg(e), false)
    } finally {
      setBusy(false)
    }
  }
  const label: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', '?': 'New' }
  return (
    <section className="changes" aria-label="Uncommitted changes">
      <form
        className="row wrap"
        style={{ padding: 6 }}
        onSubmit={(e) => {
          e.preventDefault()
          void push()
        }}
      >
        <button type="button" className="list-row" style={{ width: 'auto', minHeight: 28, padding: '0 8px', borderRadius: 6, fontWeight: 600, color: 'var(--tx)' }} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronDown size={12} className="muted" style={{ transform: open ? 'none' : 'rotate(-90deg)' }} />
          {plural(status.changes.length, 'changed file')}
        </button>
        <input className="input grow" style={{ height: 28, flex: '1 1 220px', background: 'var(--panel)' }} aria-label="Commit message" placeholder="Commit message" value={msg} onChange={(e) => setMsg(e.target.value)} />
        <button type="submit" className="btn pri" disabled={busy}>
          {busy && <Spinner size={12} />} Commit &amp; Push
        </button>
      </form>
      {open && (
        <ul className="changes-list">
          {status.changes.map((c) => (
            <li key={c.path}>
              <span className="change-code mono">{c.code === '?' ? 'A' : c.code}</span>
              <span className="mono ellipsis" style={{ fontSize: 12, textDecoration: c.code === 'D' ? 'line-through' : 'none', color: c.code === 'D' ? 'var(--tx3)' : 'var(--tx)' }}>{c.path}</span>
              <span className="muted" style={{ fontSize: 11.5 }}>{label[c.code]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function BranchMenu({ project, current, onChange }: { project: Project; current: string; onChange: () => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const close = useCallback(() => setOpen(false), [])
  const ref = useDismiss<HTMLDivElement>(open, close)
  const list = useAsync(() => (open ? api.branches(project.id) : Promise.resolve([] as string[])), [open, project.id])
  const switchTo = async (branch: string, create: boolean) => {
    setOpen(false)
    try {
      const r = await api.checkout(project.id, branch, create)
      toast(r.message, r.ok)
      onChange()
    } catch (e) {
      toast(errMsg(e), false)
    }
  }
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <GitBranch size={14} />
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--tx)' }}>{current || 'main'}</span>
        <ChevronDown size={12} className="muted" />
      </button>
      {open && (
        <div className="menu left" style={{ width: 240 }}>
          <div className="menu-label">Switch branch</div>
          {(list.data || []).map((b) => (
            <button key={b} type="button" className="menu-item" onClick={() => b !== current && switchTo(b, false)}>
              <span style={{ width: 14, display: 'flex' }}>{b === current && <Check size={14} style={{ color: 'var(--acc-text)' }} />}</span>
              <span className="mono" style={{ fontSize: 12 }}>{b}</span>
            </button>
          ))}
          <div className="menu-sep" />
          <form
            className="row"
            style={{ padding: 4, gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) void switchTo(name.trim(), true)
            }}
          >
            <input className="input mono" style={{ height: 26, fontSize: 12 }} placeholder="new-branch" aria-label="New branch name" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="btn sm" disabled={!name.trim()}>
              <Plus size={12} /> Create
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function Files({ project }: { project: Project }) {
  const { statuses, refreshStatus } = useApp()
  const toast = useToast()
  const [dir, setDir] = useState('')
  const [version, setVersion] = useState(0)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const files = useAsync(() => api.listFiles(project.id, dir), [project.id, dir, version])
  const status = statuses[project.id]

  const after = async () => {
    setVersion((v) => v + 1)
    await refreshStatus(project.id)
  }
  const act = async (label: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(label)
    try {
      const r = await fn()
      toast(r.message, r.ok)
    } catch (e) {
      toast(errMsg(e), false)
    } finally {
      setBusy(null)
      setConfirm(null)
      await after()
    }
  }
  const upload = async (paths: string[]) => {
    if (paths.length) await act('Uploading…', () => api.uploadFiles(project.id, dir, paths))
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDropping(false)
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean)
    void upload(paths)
  }
  const parts = dir ? dir.split('/') : []
  const sync = !status
    ? ''
    : !project.remote
      ? 'Local only, not on GitHub'
      : !status.upstream
        ? 'This branch is not on GitHub yet'
        : status.ahead || status.behind
          ? [status.ahead && `${status.ahead} to push`, status.behind && `${status.behind} to pull`].filter(Boolean).join(' · ')
          : `Up to date with ${status.upstream}`

  return (
    <>
      {status && status.changes.length > 0 && <ChangesBar project={project} status={status} onDone={after} />}
      <div
        className={cx('frame', dropping && 'dropping')}
        onDragOver={(e) => {
          e.preventDefault()
          setDropping(true)
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        <div className="frame-bar">
          <BranchMenu project={project} current={status?.branch || ''} onChange={after} />
          <span className="muted" style={{ fontSize: 12 }}>{busy || sync}</span>
          <span className="grow" />
          <button type="button" className="btn" disabled={!!busy || !project.remote} onClick={() => act('Pulling…', () => api.pull(project.id))}>
            <ArrowDownToLine size={14} /> Pull
          </button>
          <button type="button" className="btn pri" disabled={!!busy} onClick={async () => upload(await api.pickFiles())}>
            {busy === 'Uploading…' ? <Spinner size={12} /> : <Upload size={14} strokeWidth={2.1} />} Upload
          </button>
        </div>
        <div className="frame-sub">
          <button type="button" className="text-btn mono" style={{ fontWeight: 500, color: parts.length ? 'var(--tx2)' : 'var(--tx)' }} onClick={() => setDir('')}>
            {project.remote?.name || project.id}
          </button>
          {parts.map((seg, i) => (
            <span key={i} className="row" style={{ gap: 6 }}>
              <span style={{ color: 'var(--faint)' }} aria-hidden="true">/</span>
              <button type="button" className="text-btn mono" style={{ fontWeight: 500, color: i === parts.length - 1 ? 'var(--tx)' : 'var(--tx2)' }} onClick={() => setDir(parts.slice(0, i + 1).join('/'))}>
                {seg}
              </button>
            </span>
          ))}
        </div>
        <ul className="list" style={{ borderTop: 'none' }}>
          {dir && (
            <li className="file-row">
              <button type="button" onClick={() => setDir(parts.slice(0, -1).join('/'))}>
                <Folder size={14} className="muted" />
                <span className="mono" style={{ fontSize: 12 }}>..</span>
              </button>
            </li>
          )}
          {(files.data || []).map((f) => (
            <li key={f.path} className="file-row">
              <button type="button" onClick={() => (f.isDir ? setDir(f.path) : api.openPath(`${project.codePath}/${f.path}`))} title={f.isDir ? 'Open folder' : 'Open with its default app'}>
                {f.isDir ? <Folder size={14} fill="currentColor" className="muted" /> : <File size={14} className="muted" />}
                <span className="name ellipsis">{f.name}</span>
                {f.status && <span className="change-code mono" title="Uncommitted">{f.status === '?' ? 'A' : f.status}</span>}
                <span className="msg ellipsis">{f.lastCommit?.message || (f.status === '?' ? 'Not committed yet' : '')}</span>
                <span className="when">{f.lastCommit ? shortAgo(f.lastCommit.when) : f.isDir ? '' : bytes(f.size)}</span>
              </button>
              {confirm === f.path ? (
                <button type="button" className="btn danger sm" style={{ marginRight: 6 }} onClick={() => act('Deleting…', () => api.deletePath(project.id, f.path))}>
                  Delete
                </button>
              ) : (
                <button type="button" className="icon-btn" style={{ width: 34, height: 34, borderRadius: 0 }} aria-label={`Delete ${f.path}`} onClick={() => setConfirm(f.path)}>
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {files.data && files.data.length === 0 && <p className="muted" style={{ margin: 0, padding: '20px 14px', borderTop: '1px solid var(--line)' }}>This folder is empty.</p>}
        {files.error && <p style={{ margin: 0, padding: '20px 14px', color: 'var(--danger)' }}>{files.error}</p>}
      </div>
      <p className="muted" style={{ margin: '10px 0 0', fontSize: 11.5 }}>
        Drop files onto the list to upload them here. Uploads and deletes are committed and pushed for you; your other changes are left alone. Files over 100 MB belong in Assets.
      </p>
    </>
  )
}

function nextTag(releases: Release[]): string {
  const latest = releases.map((r) => r.tag.match(/^v?(\d+)\.(\d+)\.(\d+)$/)).find(Boolean)
  if (!latest) return 'v0.1.0'
  return `v${latest[1]}.${Number(latest[2]) + 1}.0`
}

function Releases({ project }: { project: Project }) {
  const toast = useToast()
  const [version, setVersion] = useState(0)
  const [drafting, setDrafting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const list = useAsync(() => (project.remote ? api.releases(project.id) : Promise.resolve([] as Release[])), [project.id, version])
  const [form, setForm] = useState({ tag: '', title: '', notes: '' })

  if (!project.remote) {
    return (
      <div className="empty">
        <h3>Releases live on GitHub</h3>
        <p>Create a GitHub repo first, then tag versions and attach builds like .dmg, .apk or .zip here.</p>
        <CreateRepoButton project={project} />
      </div>
    )
  }

  const run = async (label: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(label)
    try {
      const r = await fn()
      toast(r.message, r.ok)
      setVersion((v) => v + 1)
    } catch (e) {
      toast(errMsg(e), false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row">
        <span className="subhead grow" style={{ margin: 0 }}>Releases on GitHub</span>
        {!drafting && (
          <button type="button" className="btn" onClick={() => { setForm({ tag: nextTag(list.data || []), title: '', notes: '' }); setDrafting(true) }}>
            <Plus size={14} /> Draft a release
          </button>
        )}
      </div>
      {drafting && (
        <form
          className="panel"
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault()
            void run('Drafting…', () => api.createRelease(project.id, form.tag.trim(), form.title.trim(), form.notes)).then(() => setDrafting(false))
          }}
        >
          <div className="row wrap">
            <input className="input mono" style={{ flex: '0 0 140px' }} aria-label="Tag" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} />
            <input className="input grow" placeholder="Title" aria-label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <textarea className="input" rows={3} placeholder="What changed in this release" aria-label="Release notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setDrafting(false)}>Cancel</button>
            <button type="submit" className="btn pri" disabled={!form.tag.trim() || !!busy}>{busy && <Spinner size={12} />} Save draft</button>
          </div>
        </form>
      )}
      {list.loading && !list.data && (
        <p className="muted row" style={{ margin: 0 }}>
          <Spinner size={12} /> Loading releases…
        </p>
      )}
      {list.error && <p style={{ margin: 0, color: 'var(--danger)' }}>{list.error}</p>}
      {list.data && list.data.length === 0 && !drafting && (
        <div className="empty">
          <h3>No releases yet</h3>
          <p>Draft one to tag a version and upload builds like .dmg, .apk or .zip.</p>
        </div>
      )}
      {(list.data || []).map((r) => (
        <section key={r.tag} className="frame">
          <div className="row wrap" style={{ padding: '12px 16px 8px', gap: 10 }}>
            <Tag size={15} style={{ color: 'var(--acc-text)' }} />
            <span className="mono" style={{ fontWeight: 600, fontSize: 12.5 }}>{r.tag}</span>
            <span className="badge" style={{ lineHeight: '20px', padding: '0 8px' }}>{r.isDraft ? 'Draft' : 'Published'}</span>
            <span style={{ fontWeight: 600 }}>{r.name !== r.tag ? r.name : ''}</span>
            <span className="muted" style={{ fontSize: 12 }}>{r.publishedAt ? timeAgo(r.publishedAt) : ''}</span>
            <span className="grow" />
            {r.isDraft && (
              <button type="button" className="btn pri" disabled={!!busy} onClick={() => run('Publishing…', () => api.publishRelease(project.id, r.tag))}>
                Publish
              </button>
            )}
            <button type="button" className="btn icon" aria-label="View on GitHub" title="View on GitHub" onClick={() => api.openUrl(`${project.remote!.url}/releases/tag/${encodeURIComponent(r.tag)}`)}>
              <ExternalLink size={12} />
            </button>
          </div>
          <div style={{ padding: '6px 16px 14px', borderTop: '1px solid var(--line)' }}>
            <div className="subhead" style={{ margin: '6px 0 4px' }}>Builds</div>
            {r.assets.length === 0 && <p className="muted" style={{ margin: '0 0 4px', fontSize: 12 }}>No builds attached yet.</p>}
            {r.assets.map((a) => (
              <div key={a.name} className="row" style={{ height: 30, gap: 10 }}>
                <Package size={14} className="muted" />
                <span className="mono" style={{ fontSize: 12 }}>{a.name}</span>
                <span className="muted" style={{ fontSize: 11.5 }}>{bytes(a.size)}</span>
              </div>
            ))}
            <button
              type="button"
              className="btn"
              style={{ marginTop: 8 }}
              disabled={!!busy}
              onClick={async () => {
                const paths = await api.pickFiles()
                if (paths.length) await run('Uploading…', () => api.uploadReleaseAssets(project.id, r.tag, paths))
              }}
            >
              {busy === 'Uploading…' ? <Spinner size={12} /> : <Upload size={14} />} Upload build
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
