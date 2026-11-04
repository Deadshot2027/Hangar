import { useMemo, useState, type DragEvent } from 'react'
import { Folder, Search } from 'lucide-react'
import type { FoundFolder, GhRepo, NewProjectInput, Project } from '@shared/types'
import { api, errMsg } from '../api'
import { Modal, Seg, Spinner, useToast } from '../components/ui'
import { useApp, type AddTab } from '../state'
import { cx, tildify, timeAgo, useAsync } from '../util'

const GH_LINK = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#].*)?$/i

interface Row {
  key: string
  title: string
  sub: string
  kind: string
  right: string
  added: boolean
  run: () => Promise<Project>
}

/** One dialog for every way a project arrives: from GitHub, from a folder on this Mac, or new. */
export function AddProject({ initialTab, onClose }: { initialTab: AddTab; onClose: () => void }) {
  const { env, projects, refresh, go, home } = useApp()
  const toast = useToast()
  const [tab, setTab] = useState<AddTab>(initialTab)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [moveIn, setMoveIn] = useState(false)
  const [dropped, setDropped] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState<NewProjectInput>({ name: '', template: 'blank', createRepo: !!env?.gh.loggedIn, visibility: 'private' })

  const ghReady = !!env?.gh.loggedIn
  const repos = useAsync<GhRepo[]>(() => (ghReady ? api.githubRepos() : Promise.resolve([])), [ghReady])
  const found = useAsync<FoundFolder[]>(() => api.discover(), [])

  const query = q.trim()
  const ghPaste = query.match(GH_LINK)
  const pastedRepo = ghPaste ? `${ghPaste[1]}/${ghPaste[2]}` : ''
  const pastedPath = /^(~|\/)/.test(query) ? query : ''
  const search = pastedRepo || pastedPath ? '' : query.toLowerCase()
  const matches = (...t: string[]) => !search || t.some((s) => s.toLowerCase().includes(search))

  const onRemote = useMemo(() => new Set(projects.map((p) => p.remote?.fullName.toLowerCase()).filter(Boolean)), [projects])
  const linked = useMemo(() => new Set(projects.map((p) => p.codePath).filter(Boolean)), [projects])

  const ghRows: Row[] = useMemo(() => {
    const rows: Row[] = []
    const list = repos.data || []
    if (pastedRepo && !list.some((r) => r.fullName.toLowerCase() === pastedRepo.toLowerCase())) {
      rows.push({ key: `gh:${pastedRepo}`, title: pastedRepo, sub: 'Pasted link. Hangar detects the type after cloning.', kind: 'Clone', right: '', added: onRemote.has(pastedRepo.toLowerCase()), run: () => api.cloneRepo(pastedRepo) })
    }
    for (const r of list) {
      if (!matches(r.fullName, r.description, r.language)) continue
      rows.push({
        key: `gh:${r.fullName}`,
        title: r.fullName,
        sub: r.description || (r.isPrivate ? 'Private' : 'Public'),
        kind: r.language || (r.isPrivate ? 'Private' : 'Public'),
        right: onRemote.has(r.fullName.toLowerCase()) ? 'Added' : timeAgo(r.updatedAt),
        added: onRemote.has(r.fullName.toLowerCase()),
        run: () => api.cloneRepo(r.fullName, r.description)
      })
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos.data, pastedRepo, search, onRemote])

  const macRows: Row[] = useMemo(() => {
    const rows: Row[] = []
    const extra = [...dropped, ...(pastedPath ? [pastedPath] : [])]
    for (const path of extra) {
      if (rows.some((r) => r.key === `mac:${path}`)) continue
      rows.push({ key: `mac:${path}`, title: tildify(path, home), sub: 'Hangar detects the type when you add it.', kind: 'Folder', right: '', added: linked.has(path), run: () => api.linkFolder(path, moveIn) })
    }
    for (const f of found.data || []) {
      if (!matches(f.path, f.detection.label)) continue
      rows.push({
        key: `mac:${f.path}`,
        title: tildify(f.path, home),
        sub: f.isGit ? (f.hasRemote ? 'Git repo with a remote' : 'Git repo, not on GitHub') : 'Not a git repo yet',
        kind: f.detection.label,
        right: '',
        added: linked.has(f.path),
        run: () => api.linkFolder(f.path, moveIn)
      })
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found.data, dropped, pastedPath, search, linked, moveIn, home])

  const rows = tab === 'github' ? ghRows : tab === 'mac' ? macRows : []
  const chosen = rows.filter((r) => !r.added && picked.has(r.key))

  const toggle = (key: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const onQuery = (v: string) => {
    setQ(v)
    if (GH_LINK.test(v.trim())) {
      setTab('github')
      const m = v.trim().match(GH_LINK)!
      setPicked((s) => new Set(s).add(`gh:${m[1]}/${m[2]}`))
    } else if (/^(~|\/)/.test(v.trim())) {
      setTab('mac')
      setPicked((s) => new Set(s).add(`mac:${v.trim()}`))
    }
  }

  const addChosen = async () => {
    let last: Project | null = null
    const failures: string[] = []
    for (let i = 0; i < chosen.length; i++) {
      const r = chosen[i]
      setBusy(`${tab === 'github' ? 'Cloning' : 'Adding'} ${chosen.length > 1 ? `${i + 1} of ${chosen.length}: ` : ''}${r.title}…`)
      try {
        last = await r.run()
      } catch (e) {
        failures.push(`${r.title}: ${errMsg(e)}`)
      }
    }
    setBusy(null)
    await refresh()
    if (failures.length) toast(failures.join(' · '), false)
    if (last) {
      if (!failures.length) toast(chosen.length > 1 ? `Added ${chosen.length} projects.` : `Added ${last.name}. ${last.preview.command ? `Preview: ${last.preview.command}` : ''}`)
      go({ kind: 'project', id: last.id, tab: 'overview' })
      onClose()
    }
  }

  const create = async () => {
    setBusy(form.createRepo ? 'Creating the project and its GitHub repo…' : 'Creating the project…')
    try {
      const { project, warning } = await api.createProject(form)
      await refresh()
      toast(warning || `Created ${project.name}${form.createRepo ? ' and its GitHub repo' : ''}.`, !warning)
      go({ kind: 'project', id: project.id, tab: 'overview' })
      onClose()
    } catch (e) {
      toast(errMsg(e), false)
    } finally {
      setBusy(null)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean)
    if (!paths.length) return
    setTab('mac')
    setDropped((d) => [...new Set([...paths, ...d])])
    setPicked((s) => new Set([...s, ...paths.map((p) => `mac:${p}`)]))
  }

  const chooseFolder = async () => {
    const path = await api.pickFolder()
    if (!path) return
    setDropped((d) => [...new Set([path, ...d])])
    setPicked((s) => new Set(s).add(`mac:${path}`))
  }

  const slug = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-project'
  const primary =
    tab === 'new' ? (
      <button type="button" className="btn pri tall" disabled={!form.name.trim() || !!busy} onClick={create}>
        {busy && <Spinner size={12} />} Create project
      </button>
    ) : (
      <button type="button" className="btn pri tall" disabled={!chosen.length || !!busy} onClick={addChosen}>
        {busy && <Spinner size={12} />} {chosen.length > 1 ? `Add ${chosen.length} projects` : 'Add project'}
      </button>
    )

  return (
    <Modal
      title="Add project"
      onClose={onClose}
      footer={
        <>
          <span className="hint">
            {busy || (tab === 'new' ? 'Creates the folder, a first commit and (if you like) the GitHub repo.' : chosen.length ? `${chosen.length} selected. Hangar detects each type and sets up Preview.` : 'Pick one or more. Hangar detects the type and sets up Preview for you.')}
          </span>
          <button type="button" className="btn tall" onClick={onClose}>Cancel</button>
          {primary}
        </>
      }
    >
      <div
        className={cx(dragging && 'dropping')}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 18px 0' }}>
          <label className="input-group" style={{ height: 36 }}>
            <Search size={14} className="muted" style={{ marginLeft: 12 }} />
            <span className="sr">Search, or paste a GitHub link or folder path</span>
            <input value={q} onChange={(e) => onQuery(e.target.value)} placeholder="Search, or paste a GitHub link or folder path" style={{ fontSize: 13 }} autoFocus />
          </label>
          <div>
            <Seg label="Add from" value={tab} onChange={setTab} options={[{ value: 'github', label: 'GitHub' }, { value: 'mac', label: 'This Mac' }, { value: 'new', label: 'New' }]} />
          </div>
        </div>
        <div style={{ height: 320, overflowY: 'auto', padding: '10px 10px 12px' }}>
          {tab === 'github' && !ghReady && !pastedRepo && (
            <div className="empty" style={{ margin: 8 }}>
              <h3>Connect GitHub</h3>
              <p>
                Hangar uses the GitHub CLI so it never stores your password.{' '}
                {env?.gh.installed ? (
                  <>Run <code className="mono">gh auth login</code> in Terminal, then reopen this dialog.</>
                ) : (
                  <>Install it with <code className="mono">brew install gh</code>, run <code className="mono">gh auth login</code>, then reopen this dialog.</>
                )}{' '}
                You can still paste a public GitHub link above.
              </p>
            </div>
          )}
          {tab === 'github' && ghReady && repos.loading && !repos.data && <p className="muted row" style={{ padding: 12 }}><Spinner size={12} /> Loading your repositories…</p>}
          {tab === 'github' && repos.error && <p style={{ padding: 12, color: 'var(--danger)' }}>{repos.error}</p>}

          {tab === 'mac' && (
            <>
              <button type="button" className="empty" style={{ width: '100%', padding: 16, marginBottom: 8, flexDirection: 'row', justifyContent: 'center', color: 'var(--tx3)', fontSize: 12.5 }} onClick={chooseFolder}>
                <Folder size={16} />
                <span>
                  Drop a folder here, or <span style={{ color: 'var(--tx)', textDecoration: 'underline', textUnderlineOffset: 3 }}>choose one</span>
                </span>
              </button>
              <div className="subhead" style={{ padding: '6px 8px 0' }}>Found on this Mac</div>
              {found.loading && !found.data && <p className="muted row" style={{ padding: '4px 8px' }}><Spinner size={12} /> Looking in your usual code folders…</p>}
            </>
          )}

          {tab !== 'new' && (
            <ul className="list">
              {rows.map((r) => (
                <li key={r.key}>
                  <label className={cx('pick-row', r.added && 'added')}>
                    <input type="checkbox" checked={r.added || picked.has(r.key)} disabled={r.added} onChange={() => toggle(r.key)} />
                    <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="mono ellipsis" style={{ fontSize: 12, color: 'var(--tx)' }}>{r.title}</span>
                      <span className="ellipsis muted" style={{ fontSize: 11.5 }}>{r.sub}</span>
                    </span>
                    <span className="chip" style={{ height: 20, fontSize: 11 }}>{r.kind}</span>
                    <span className="muted" style={{ flex: '0 0 56px', textAlign: 'right', fontSize: 11.5 }}>{r.added ? 'Added' : r.right}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {tab === 'github' && ghReady && repos.data && ghRows.length === 0 && <p className="muted" style={{ padding: '40px 12px', textAlign: 'center' }}>No repositories match that search.</p>}
          {tab === 'mac' && found.data && macRows.length === 0 && <p className="muted" style={{ padding: '8px', fontSize: 12 }}>Nothing else found in ~/Developer, ~/Projects, ~/Code, ~/Documents or ~/Desktop.</p>}
          {tab === 'mac' && (
            <label className="check" style={{ margin: '12px 8px 0', color: 'var(--tx2)', fontSize: 12 }}>
              <input type="checkbox" checked={moveIn} onChange={(e) => setMoveIn(e.target.checked)} />
              Move the folders into Hangar’s folder. Otherwise they stay where they are.
            </label>
          )}

          {tab === 'new' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '6px 8px' }}>
              <label style={{ fontSize: 12 }} className="dim">
                Name
                <input className="input" style={{ height: 34, marginTop: 6, fontSize: 13.5 }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My new project" autoFocus />
              </label>
              <div>
                <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>Starts as</div>
                <Seg
                  label="Template"
                  value={form.template}
                  onChange={(template) => setForm({ ...form, template })}
                  options={[{ value: 'blank', label: 'Blank' }, { value: 'web', label: 'Web app (Vite)' }, { value: 'game', label: 'Browser game' }, { value: 'python', label: 'Python' }]}
                />
              </div>
              <div className="row wrap">
                <label className="check" style={{ opacity: ghReady ? 1 : 0.5 }}>
                  <input type="checkbox" checked={form.createRepo && ghReady} disabled={!ghReady} onChange={(e) => setForm({ ...form, createRepo: e.target.checked })} />
                  Create a GitHub repo <span className="mono muted" style={{ fontSize: 11.5 }}>{env?.gh.user ? `${env.gh.user}/${slug}` : slug}</span>
                </label>
                {form.createRepo && ghReady && <Seg label="Visibility" value={form.visibility} onChange={(visibility) => setForm({ ...form, visibility })} options={[{ value: 'private', label: 'Private' }, { value: 'public', label: 'Public' }]} />}
              </div>
              {!ghReady && <p className="muted" style={{ margin: 0, fontSize: 12 }}>Connect GitHub (run <code className="mono">gh auth login</code>) to create the repo too. You can always do it later.</p>}
              <div className="panel" style={{ padding: '10px 12px', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                {['notes.md', 'assets/', 'repo/'].map((f) => (
                  <span key={f} className="mono dim" style={{ fontSize: 11.5 }}>{tildify(env?.vault || '', home)}/{slug}/{f}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
