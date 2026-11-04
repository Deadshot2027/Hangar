import { useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, ChevronDown, ExternalLink, RotateCw, TerminalSquare } from 'lucide-react'
import type { PreviewState, Project } from '@shared/types'
import { api, errMsg } from '../api'
import { Seg, Spinner } from '../components/ui'
import { useApp } from '../state'

type Target = 'browser' | 'window' | 'output'
type Viewport = 'desktop' | 'tablet' | 'phone'

const VIEWPORTS: Record<Viewport, { width: string; height: number }> = {
  desktop: { width: '100%', height: 560 },
  tablet: { width: '820px', height: 600 },
  phone: { width: '390px', height: 700 }
}

/**
 * The Preview tab: starts the project's preview command when it opens and
 * stops it when it closes. A web page shows live inside Hangar at desktop,
 * tablet or phone width (no emulator); desktop apps open their own window and
 * their output shows here; scripts show their output.
 */
export function Preview({ project }: { project: Project }) {
  const { go } = useApp()
  const [state, setState] = useState<PreviewState | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [players, setPlayers] = useState(1)
  const [dockOpen, setDockOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const command = project.preview.command.trim()
  const canRun = !!command && !!project.codePath && project.codeExists

  useEffect(() => {
    if (!canRun) return
    let alive = true
    setError(null)
    const off = api.onPreview((e) => {
      if (e.id !== project.id) return
      if (e.type === 'log') setLogs((l) => (l.length > 600 ? [...l.slice(-500), e.line] : [...l, e.line]))
      if (e.type === 'url') setState((s) => (s ? { ...s, url: e.url } : s))
      if (e.type === 'status') setState((s) => (s ? { ...s, status: e.status, exitCode: e.exitCode ?? s.exitCode } : s))
    })
    api
      .previewStart(project.id)
      .then((s) => {
        if (!alive) return
        setState(s)
        setLogs(s.logs)
      })
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
      off()
      void api.previewStop(project.id)
    }
  }, [project.id, canRun, command])

  const restart = async () => {
    setError(null)
    try {
      const s = await api.previewRestart(project.id)
      setState(s)
      setLogs(s.logs)
      setReloadKey((k) => k + 1)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const kind = project.preview.kind
  const url = state?.url ?? null
  const targets = useMemo(() => {
    const t: Target[] = []
    if (kind === 'desktop') t.push('window')
    if (kind === 'web' || url) t.push('browser')
    if (kind === 'console' || kind === 'none') t.push('output')
    return t
  }, [kind, url])
  const active: Target = target && targets.includes(target) ? target : targets[0]
  const isGame = project.tags.some((t) => /game|multiplayer/i.test(t))

  if (!project.codePath || !project.codeExists) {
    return (
      <div className="empty">
        <h3>No code to preview yet</h3>
        <p>{project.codePath ? 'The code folder for this project is missing. Was it moved or renamed?' : 'Add code to this project by creating a GitHub repo for it, or link a folder in Settings.'}</p>
      </div>
    )
  }
  if (!command) {
    return (
      <div className="empty">
        <h3>No preview command yet</h3>
        <p>Set one in Settings, like npm run dev or python3 main.py. After that the preview starts by itself whenever you open this tab.</p>
        <button type="button" className="btn" onClick={() => go({ kind: 'project', id: project.id, tab: 'settings' })}>Open Settings</button>
      </div>
    )
  }

  const status = state?.status ?? 'starting'
  const exited = status === 'exited'
  const statusText = error
    ? 'Could not start'
    : exited
      ? `Stopped${state?.exitCode != null ? ` (exit ${state.exitCode})` : ''}`
      : status === 'installing'
        ? 'Installing packages…'
        : url
          ? 'Live'
          : status === 'running'
            ? 'Running'
            : 'Starting…'
  const dotColor = !error && !exited && (url || (status === 'running' && kind !== 'web')) ? 'var(--ok)' : exited || error ? 'var(--danger)' : 'var(--faint)'

  return (
    <div className="frame">
      <div className="frame-bar">
        {targets.length > 1 && (
          <Seg
            label="Preview as"
            value={active}
            onChange={setTarget}
            options={targets.map((t) => ({ value: t, label: t === 'window' ? 'App window' : t === 'browser' ? 'Browser' : 'Output' }))}
          />
        )}
        {active === 'browser' && (
          <>
            <Seg label="Viewport" value={viewport} onChange={setViewport} options={[{ value: 'desktop', label: 'Desktop' }, { value: 'tablet', label: 'Tablet' }, { value: 'phone', label: 'Phone' }]} />
            {isGame && (
              <div className="seg" role="group" aria-label="Players" style={{ alignItems: 'center', paddingLeft: 8 }}>
                <span className="muted" style={{ fontSize: 11.5, marginRight: 4 }} aria-hidden="true">Players</span>
                {[1, 2, 4].map((n) => (
                  <button key={n} type="button" className={players === n ? 'on' : ''} aria-pressed={players === n} aria-label={`${n} player${n > 1 ? 's' : ''}`} onClick={() => setPlayers(n)} style={{ minWidth: 26, textAlign: 'center' }}>
                    {n}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <span className="grow" />
        <span className="row muted" style={{ gap: 6, fontSize: 12 }}>
          {!error && !exited && !url && status !== 'running' ? <Spinner size={11} /> : <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor }} aria-hidden="true" />}
          {statusText}
        </span>
        {active === 'browser' && url && (
          <>
            <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--bg)', fontSize: 11, color: 'var(--tx2)' }}>
              {url.replace(/^https?:\/\//, '')}
            </span>
            <button type="button" className="btn icon" aria-label="Open in browser" title="Open in browser" onClick={() => api.openUrl(url)}>
              <ExternalLink size={12} />
            </button>
          </>
        )}
        <button type="button" className="btn icon" aria-label="Restart" title="Restart" onClick={restart}>
          <RotateCw size={13} />
        </button>
      </div>

      {active === 'browser' && (
        <div className="stage">
          {url && !exited ? (
            Array.from({ length: players }, (_, i) => {
              const multi = players > 1
              const vp = VIEWPORTS[viewport]
              const width = multi ? (viewport === 'phone' ? '300px' : 'calc(50% - 8px)') : vp.width
              const height = multi ? (players === 4 ? 300 : 460) : vp.height
              const src = multi ? `${url}${url.includes('?') ? '&' : '?'}player=${i + 1}` : url
              return (
                <div key={`${i}-${reloadKey}`} className="device" style={{ width, maxWidth: '100%', height, flex: multi || viewport !== 'desktop' ? 'none' : '1 1 auto' }}>
                  <div className="device-bar">
                    <span style={{ fontWeight: 600, color: 'var(--tx2)' }}>{multi ? `Player ${i + 1}` : viewport === 'desktop' ? 'Desktop' : viewport === 'tablet' ? 'Tablet' : 'Phone'}</span>
                    <span className="mono ellipsis" style={{ fontSize: 10.5 }}>{src.replace(/^https?:\/\//, '')}</span>
                  </div>
                  <webview src={src} partition={`preview-${project.id}-${i}`} style={{ flex: 1, width: '100%' }} />
                </div>
              )
            })
          ) : (
            <Waiting state={state} error={error} exited={exited} logs={logs} onRestart={restart} />
          )}
        </div>
      )}

      {active === 'window' && (
        <div className="stage center" style={{ minHeight: 360 }}>
          {exited || error ? (
            <Waiting state={state} error={error} exited={exited} logs={logs} onRestart={restart} />
          ) : (
            <div className="waiting">
              <AppWindow size={22} className="muted" />
              <h3 style={{ margin: 0, fontSize: 13 }}>{status === 'running' ? `${project.name} is running in its own window` : `Starting ${project.name}…`}</h3>
              <p>
                Desktop apps open as a real window, so you can click around in them normally. The output is below.
                {project.preview.url || url ? ' Switch to Browser to see just the interface inside Hangar.' : ''}
              </p>
            </div>
          )}
        </div>
      )}

      {active === 'output' && (
        <div style={{ padding: '12px 14px', background: 'var(--bg)', minHeight: 360, maxHeight: 560, overflowY: 'auto' }}>
          <div className="subhead">Output</div>
          {error ? <p style={{ margin: 0, color: 'var(--danger)', fontSize: 12 }}>{error}</p> : <LogList lines={logs} follow />}
        </div>
      )}

      {active !== 'output' && (
        <div className="dock">
          <button type="button" className="list-row" style={{ minHeight: 30, padding: '0 12px' }} aria-expanded={dockOpen || active === 'window'} onClick={() => setDockOpen((o) => !o)}>
            <ChevronDown size={12} className="muted" style={{ transform: dockOpen || active === 'window' ? 'none' : 'rotate(-90deg)' }} />
            <TerminalSquare size={12} className="muted" />
            <span className="subhead" style={{ margin: 0 }}>Output</span>
            <span className="muted" style={{ fontSize: 11.5 }}>{logs.length ? `${logs.length} lines` : ''}</span>
          </button>
          {(dockOpen || active === 'window') && (
            <div className="dock-body">
              <LogList lines={logs} follow />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Waiting({ state, error, exited, logs, onRestart }: { state: PreviewState | null; error: string | null; exited: boolean; logs: string[]; onRestart: () => void }) {
  if (error || exited) {
    return (
      <div className="waiting" style={{ alignSelf: 'center', marginTop: 60 }}>
        <h3 style={{ margin: 0, fontSize: 13 }}>{error ? 'The preview could not start' : 'The preview command stopped'}</h3>
        <p className="selectable">{error || logs.slice(-3).join(' · ') || 'It exited without printing anything.'}</p>
        <button type="button" className="btn" onClick={onRestart}>
          <RotateCw size={12} /> Try again
        </button>
      </div>
    )
  }
  return (
    <div className="waiting" style={{ alignSelf: 'center', marginTop: 80 }}>
      <Spinner size={18} />
      <h3 style={{ margin: 0, fontSize: 13 }}>{state?.status === 'installing' ? 'Installing packages…' : 'Starting the dev server…'}</h3>
      <p className="mono">{state?.command || ''}</p>
    </div>
  )
}

function LogList({ lines, follow }: { lines: string[]; follow?: boolean }) {
  const end = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (follow) end.current?.scrollIntoView({ block: 'nearest' })
  }, [lines.length, follow])
  if (!lines.length) return <p className="muted" style={{ margin: 0, fontSize: 12 }}>Waiting for output…</p>
  return (
    <ol className="log">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
      <li ref={end} aria-hidden="true" />
    </ol>
  )
}
