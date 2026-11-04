import { useEffect, useState } from 'react'
import type { LaunchKind, PreviewKind, Project, RepoInfo, Status } from '@shared/types'
import { api, errMsg } from '../api'
import { Modal, STATUS_LABEL, STATUS_ORDER, Seg, Spinner, useToast } from '../components/ui'
import { useApp } from '../state'
import { tildify, useAsync } from '../util'
import { CreateRepoButton } from './Repository'

/** A text field that saves when you leave it (or press Return). */
function Field({ value, onSave, ...rest }: { value: string; onSave: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      {...rest}
      className={rest.className || 'input'}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

/** The backends the preview waits for: found in the code unless you list them (or turn waiting off). */
function WaitFor({ project, save }: { project: Project; save: (patch: Parameters<typeof api.updateProject>[1], message?: string) => Promise<void> }) {
  const [found, setFound] = useState<string[] | null>(null)
  const set = project.preview.waitFor
  useEffect(() => {
    let alive = true
    api.detectBackends(project.id).then((b) => alive && setFound(b), () => alive && setFound([]))
    return () => {
      alive = false
    }
  }, [project.id, project.codePath])
  const auto = found?.length ? found.join(', ') : 'nothing found in the code'
  return (
    <div className="settings-row">
      <div className="label">
        <b>Wait for</b>
        <span>The preview stays on its loading screen until these answer, so a page never shows before its backend is up.</span>
      </div>
      <div className="control">
        {set && set.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Shows as soon as the page loads.{' '}
            <button type="button" className="link" onClick={() => save({ preview: { ...project.preview, waitFor: undefined } })}>
              Wait for backends again
            </button>
          </p>
        ) : (
          <>
            <Field
              className="input mono"
              aria-label="Backends to wait for"
              value={(set || []).join(', ')}
              placeholder={found === null ? 'Looking in the code…' : `Found: ${auto}`}
              onSave={(v) => {
                const list = v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)
                return save({ preview: { ...project.preview, waitFor: list.length ? list : undefined } })
              }}
            />
            <div className="row wrap" style={{ gap: 12 }}>
              <span className="muted" style={{ fontSize: 12 }}>{set ? 'Leave empty to use what Hangar finds in the code.' : 'Type addresses to wait for something else.'}</span>
              <button type="button" className="text-btn" onClick={() => save({ preview: { ...project.preview, waitFor: [] } })}>
                Don’t wait
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function ProjectSettings({ project }: { project: Project }) {
  const { refresh, go, home } = useApp()
  const toast = useToast()
  const [confirm, setConfirm] = useState<'remove' | 'delete' | null>(null)

  const save = async (patch: Parameters<typeof api.updateProject>[1], message?: string) => {
    try {
      await api.updateProject(project.id, patch)
      await refresh()
      if (message) toast(message)
    } catch (e) {
      toast(errMsg(e), false)
    }
  }

  const detectAgain = async () => {
    if (!project.codePath) return
    try {
      const d = await api.detect(project.codePath)
      await save({ preview: { command: d.command, kind: d.kind, url: d.url } }, d.command ? `Detected a ${d.label}: ${d.command}` : `Detected a ${d.label}, but no command to run it.`)
    } catch (e) {
      toast(errMsg(e), false)
    }
  }

  const pickApp = async () => {
    const [path] = await api.pickFiles()
    if (path) await save({ launch: { kind: 'app', target: path } })
  }

  const lk = project.launch.kind
  return (
    <div style={{ maxWidth: 800, display: 'flex', flexDirection: 'column', gap: 22 }}>
      <section>
        <h2 className="subhead">Project</h2>
        <div className="frame settings-rows">
          <div className="settings-row">
            <div className="label"><b>Name</b></div>
            <div className="control"><Field aria-label="Name" value={project.name} onSave={(name) => name.trim() && save({ name: name.trim() })} /></div>
          </div>
          <div className="settings-row">
            <div className="label"><b>Description</b><span>One line, shown in the project list.</span></div>
            <div className="control"><Field aria-label="Description" value={project.description} placeholder="What is this project?" onSave={(description) => save({ description: description.trim() })} /></div>
          </div>
          <div className="settings-row">
            <div className="label"><b>Status</b></div>
            <div className="control">
              <Seg<Status> label="Status" value={project.status} onChange={(status) => save({ status })} options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
            </div>
          </div>
          <div className="settings-row">
            <div className="label"><b>Tags</b><span>Separate with commas.</span></div>
            <div className="control">
              <Field aria-label="Tags" value={project.tags.join(', ')} placeholder="web, game" onSave={(t) => save({ tags: t.split(',').map((s) => s.trim()).filter(Boolean) })} />
            </div>
          </div>
          <div className="settings-row">
            <div className="label"><b>Folders</b><span>Everything is plain files you can open yourself.</span></div>
            <div className="control" style={{ gap: 4 }}>
              <button type="button" className="text-btn mono" style={{ fontSize: 11.5 }} onClick={() => api.openPath(project.home)}>Project · {tildify(project.home, home)}</button>
              {project.codePath && <button type="button" className="text-btn mono" style={{ fontSize: 11.5 }} onClick={() => api.openPath(project.codePath!)}>Code · {tildify(project.codePath, home)}</button>}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="subhead">Launch and preview</h2>
        <div className="frame settings-rows">
          <div className="settings-row">
            <div className="label">
              <b>Launch opens</b>
              <span>{lk === 'app' ? 'The installed app, not the dev build.' : lk === 'url' ? 'The live site, in your browser.' : lk === 'cmd' ? 'A command in Terminal, like the real pipeline.' : 'What the Launch button opens for this project.'}</span>
            </div>
            <div className="control">
              <Seg<LaunchKind>
                label="Launch opens"
                value={lk}
                onChange={(kind) => save({ launch: { kind, target: kind === 'app' ? `/Applications/${project.name}.app` : '' } })}
                options={[{ value: 'app', label: 'Installed app' }, { value: 'url', label: 'Website' }, { value: 'cmd', label: 'Command' }, { value: 'none', label: 'Nothing' }]}
              />
              {lk !== 'none' && (
                <div className="row" style={{ width: '100%' }}>
                  <Field
                    className="input mono"
                    aria-label={lk === 'app' ? 'App path' : lk === 'url' ? 'Website address' : 'Command'}
                    value={project.launch.target}
                    placeholder={lk === 'app' ? '/Applications/My App.app' : lk === 'url' ? 'https://my-site.com' : 'python3 -m clip_engine'}
                    onSave={(target) => save({ launch: { kind: lk, target: target.trim() } })}
                  />
                  {lk === 'app' && <button type="button" className="btn tall" onClick={pickApp}>Choose…</button>}
                </div>
              )}
            </div>
          </div>
          <div className="settings-row">
            <div className="label">
              <b>Preview command</b>
              <span>Starts by itself when you open the Preview tab, and stops when you leave it.</span>
            </div>
            <div className="control">
              <div className="input-group" style={{ width: '100%' }}>
                <span className="prefix mono" aria-hidden="true">$</span>
                <Field className="mono" aria-label="Preview command" value={project.preview.command} placeholder="npm run dev" onSave={(command) => save({ preview: { ...project.preview, command: command.trim() } })} />
              </div>
              <div className="row wrap">
                <Seg<PreviewKind>
                  label="Shows as"
                  value={project.preview.kind === 'none' ? 'console' : project.preview.kind}
                  onChange={(kind) => save({ preview: { ...project.preview, kind } })}
                  options={[{ value: 'web', label: 'Web page' }, { value: 'desktop', label: 'Desktop app' }, { value: 'console', label: 'Script' }]}
                />
                {project.codePath && <button type="button" className="btn" onClick={detectAgain}>Detect again</button>}
              </div>
            </div>
          </div>
          {project.preview.kind !== 'console' && <WaitFor project={project} save={save} />}
        </div>
      </section>

      <section>
        <h2 className="subhead">Repository</h2>
        {project.remote ? <RepoSettings project={project} onDelete={() => setConfirm('delete')} /> : (
          <div className="empty" style={{ alignItems: 'flex-start', textAlign: 'left' }}>
            <h3>Not on GitHub yet</h3>
            <p>{project.isGit ? 'This repo has no GitHub remote.' : 'Hangar can set up git and a first commit for you.'}</p>
            <CreateRepoButton project={project} />
          </div>
        )}
      </section>

      <section>
        <h2 className="subhead">Remove</h2>
        <div className="frame settings-rows">
          <div className="settings-row" style={{ alignItems: 'center' }}>
            <div className="label">
              <b>Remove from Hangar</b>
              <span>{project.code && project.code !== 'repo' ? 'Moves the project folder (notes, assets) to the Trash. The linked code folder is not touched.' : 'Moves the project folder, including its code, to the Trash. You can restore it from there.'}</span>
            </div>
            <button type="button" className="btn danger" onClick={() => setConfirm('remove')}>Remove</button>
          </div>
        </div>
      </section>

      {confirm === 'remove' && (
        <Modal
          title={`Remove ${project.name}?`}
          size="sm"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <span className="hint" />
              <button type="button" className="btn tall" onClick={() => setConfirm(null)}>Cancel</button>
              <button
                type="button"
                className="btn danger fill tall"
                onClick={async () => {
                  try {
                    await api.removeProject(project.id)
                    setConfirm(null)
                    go({ kind: 'home' })
                    await refresh()
                    toast(`Moved ${project.name} to the Trash.`)
                  } catch (e) {
                    toast(errMsg(e), false)
                  }
                }}
              >
                Move to Trash
              </button>
            </>
          }
        >
          <div className="modal-b">
            <p style={{ margin: 0, fontSize: 12.5 }} className="dim">
              {tildify(project.home, home)} goes to the Trash. {project.code && project.code !== 'repo' ? `Your code at ${tildify(project.codePath, home)} stays where it is.` : 'That includes its code.'} Nothing on GitHub changes.
            </p>
          </div>
        </Modal>
      )}
      {confirm === 'delete' && project.remote && <DeleteRepoDialog project={project} onClose={() => setConfirm(null)} />}
    </div>
  )
}

function RepoSettings({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const { refresh } = useApp()
  const toast = useToast()
  const [version, setVersion] = useState(0)
  const info = useAsync<RepoInfo | null>(() => api.repoInfo(project.id), [project.id, version])
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true)
    try {
      const r = await fn()
      toast(r.message, r.ok)
      setVersion((v) => v + 1)
      await refresh()
    } catch (e) {
      toast(errMsg(e), false)
    } finally {
      setBusy(false)
    }
  }
  if (info.loading && !info.data) {
    return <p className="muted row" style={{ margin: 0 }}><Spinner size={12} /> Loading {project.remote!.fullName}…</p>
  }
  if (info.error) return <p style={{ margin: 0, color: 'var(--danger)' }}>{info.error}</p>
  const r = info.data!
  const isPrivate = r.visibility !== 'PUBLIC'
  return (
    <div className="frame settings-rows">
      <div className="settings-row">
        <div className="label"><b>Name</b><span>Renames it on GitHub and updates the local remote.</span></div>
        <div className="control">
          <div className="input-group" style={{ width: '100%' }}>
            <span className="prefix mono">{project.remote!.owner} /</span>
            <Field className="mono" aria-label="Repository name" value={r.name} onSave={(name) => name.trim() && name.trim() !== r.name && run(() => api.renameRepo(project.id, name.trim()))} />
          </div>
        </div>
      </div>
      <div className="settings-row" style={{ alignItems: 'center' }}>
        <div className="label"><b>Visibility</b><span>{isPrivate ? 'Only you and collaborators can see it.' : 'Anyone on the internet can see it.'}</span></div>
        <div className="control">
          <Seg label="Visibility" value={isPrivate ? 'private' : 'public'} onChange={(v) => !busy && run(() => api.setVisibility(project.id, v as 'private' | 'public'))} options={[{ value: 'private', label: 'Private' }, { value: 'public', label: 'Public' }]} />
        </div>
      </div>
      <div className="settings-row" style={{ alignItems: 'center' }}>
        <div className="label"><b>{r.isArchived ? 'Archived' : 'Archive'}</b><span>{r.isArchived ? 'Read-only. Unarchive it to push again.' : 'Makes it read-only. You can undo this.'}</span></div>
        <button type="button" className="btn" disabled={busy} onClick={() => run(() => api.setArchived(project.id, !r.isArchived))}>{r.isArchived ? 'Unarchive' : 'Archive'}</button>
      </div>
      <div className="settings-row" style={{ alignItems: 'center' }}>
        <div className="label"><b style={{ color: 'var(--danger)' }}>Delete repository</b><span>Deletes it on GitHub. Your local folder, notes and assets stay.</span></div>
        <button type="button" className="btn danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  )
}

function DeleteRepoDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const { refresh } = useApp()
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const name = project.remote!.name
  return (
    <Modal
      title={`Delete ${project.remote!.fullName}?`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <span className="hint" />
          <button type="button" className="btn tall" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn danger fill tall"
            disabled={text.trim() !== name || busy}
            onClick={async () => {
              setBusy(true)
              try {
                const r = await api.deleteRepo(project.id)
                toast(r.message, r.ok)
                onClose()
                await refresh()
              } catch (e) {
                toast(errMsg(e), false)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <Spinner size={12} />} Delete repository
          </button>
        </>
      }
    >
      <div className="modal-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 12.5 }} className="dim">This permanently deletes the repository on GitHub, including its history, issues and releases. Your local folder is kept.</p>
        <label style={{ fontSize: 12 }} className="dim">
          Type <span className="mono" style={{ color: 'var(--tx)' }}>{name}</span> to confirm
          <input className="input mono" style={{ marginTop: 6 }} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </label>
      </div>
    </Modal>
  )
}
