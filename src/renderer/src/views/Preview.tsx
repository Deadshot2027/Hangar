import { useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, ChevronDown, ExternalLink, MousePointerClick, RotateCw, ShieldAlert, TerminalSquare } from 'lucide-react'
import type { DesktopView, PreviewState, Project, WindowList } from '@shared/types'
import { api, errMsg } from '../api'
import { Seg, Spinner, useToast } from '../components/ui'
import { useApp } from '../state'

type Target = 'browser' | 'interface' | 'window' | 'output'
type Viewport = 'desktop' | 'tablet' | 'phone'

const VIEWPORTS: Record<Viewport, { width: string; height: number }> = {
  desktop: { width: '100%', height: 560 },
  tablet: { width: '820px', height: 600 },
  phone: { width: '390px', height: 700 }
}

const TARGET_LABEL: Record<Target, string> = { browser: 'Browser', interface: 'Interface', window: 'Window', output: 'Output' }

/** The view a desktop app opens in: what you chose last, else its interface when it has a web one. */
function defaultView(project: Project): DesktopView {
  if (project.preview.view) return project.preview.view
  if (project.tags.includes('electron')) return 'window'
  return project.preview.url ? 'interface' : 'window'
}

/**
 * The Preview tab. Opening it starts the project's preview command; leaving it
 * stops it. Everything shows inside the box: web pages at desktop, tablet or
 * phone width; desktop apps as their web interface (their own window hidden) or
 * as a live view of their real window; scripts as their output.
 */
export function Preview({ project }: { project: Project }) {
  const { go, refresh } = useApp()
  const [state, setState] = useState<PreviewState | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<Target | null>(project.preview.kind === 'desktop' ? defaultView(project) : null)
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [players, setPlayers] = useState(1)
  const [dockOpen, setDockOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const command = project.preview.command.trim()
  const canRun = !!command && !!project.codePath && project.codeExists
  const kind = project.preview.kind
  const view = useRef<DesktopView | undefined>(kind === 'desktop' ? defaultView(project) : undefined)

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
      .previewStart(project.id, view.current)
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
      const s = await api.previewRestart(project.id, view.current)
      setState(s)
      setLogs(s.logs)
      setReloadKey((k) => k + 1)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const url = state?.url ?? null
  const uiUrl = url || (kind === 'desktop' && state?.status === 'running' ? project.preview.url || null : null)
  const targets = useMemo(() => {
    if (kind === 'web') return ['browser'] as Target[]
    if (kind === 'desktop') return (project.preview.url || url ? ['interface', 'window'] : ['window']) as Target[]
    // Scripts can open windows too (pygame, Godot, a Tk app): offer the window view beside the output.
    return (url ? ['browser', 'output', 'window'] : ['output', 'window']) as Target[]
  }, [kind, url, project.preview.url])
  const active: Target = target && targets.includes(target) ? target : targets[0]

  const choose = async (t: Target) => {
    setTarget(t)
    if (kind !== 'desktop' || (t !== 'interface' && t !== 'window')) return
    view.current = t
    await api.previewSetView(project.id, t)
    if (project.preview.view !== t) {
      await api.updateProject(project.id, { preview: { ...project.preview, view: t } })
      await refresh()
    }
  }

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
  const running = !!state && !exited && !error
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
  const live = !error && !exited && (url || (status === 'running' && kind !== 'web'))
  const dotColor = live ? 'var(--ok)' : exited || error ? 'var(--danger)' : 'var(--faint)'

  return (
    <div className="frame">
      <div className="frame-bar">
        {targets.length > 1 && <Seg label="Preview as" value={active} onChange={choose} options={targets.map((t) => ({ value: t, label: TARGET_LABEL[t] }))} />}
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
          {!live && !error && !exited ? <Spinner size={11} /> : <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor }} aria-hidden="true" />}
          {statusText}
        </span>
        {(active === 'browser' || active === 'interface') && uiUrl && (
          <>
            <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--bg)', fontSize: 11, color: 'var(--tx2)' }}>
              {uiUrl.replace(/^https?:\/\//, '')}
            </span>
            <button type="button" className="btn icon" aria-label="Open in browser" title="Open in browser" onClick={() => api.openUrl(uiUrl)}>
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
                  <LivePage src={src} partition={`preview-${project.id}-${i}`} />
                </div>
              )
            })
          ) : (
            <Waiting state={state} error={error} exited={exited} logs={logs} onRestart={restart} />
          )}
        </div>
      )}

      {active === 'interface' && (
        <div className="stage">
          {uiUrl && !exited && !error ? (
            <div className="device" style={{ width: '100%', height: 640, flex: '1 1 auto' }}>
              <div className="device-bar">
                <span style={{ fontWeight: 600, color: 'var(--tx2)' }}>{project.name}</span>
                <span className="ellipsis">its own window is hidden while you preview it here</span>
              </div>
              <LivePage key={reloadKey} src={uiUrl} partition={`preview-${project.id}-ui`} />
            </div>
          ) : (
            <Waiting state={state} error={error} exited={exited} logs={logs} onRestart={restart} label={`Starting ${project.name}…`} />
          )}
        </div>
      )}

      {active === 'window' && (
        <div className="stage center" style={{ minHeight: 420 }}>
          {exited || error ? <Waiting state={state} error={error} exited={exited} logs={logs} onRestart={restart} /> : <WindowMirror project={project} running={running} />}
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
          <button type="button" className="list-row" style={{ minHeight: 30, padding: '0 12px' }} aria-expanded={dockOpen} onClick={() => setDockOpen((o) => !o)}>
            <ChevronDown size={12} className="muted" style={{ transform: dockOpen ? 'none' : 'rotate(-90deg)' }} />
            <TerminalSquare size={12} className="muted" />
            <span className="subhead" style={{ margin: 0 }}>Output</span>
            <span className="muted" style={{ fontSize: 11.5 }}>{logs.length ? `${logs.length} lines` : ''}</span>
          </button>
          {dockOpen && (
            <div className="dock-body">
              <LogList lines={logs} follow />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** A web page in the box that keeps retrying while its dev server is still coming up. */
function LivePage({ src, partition }: { src: string; partition: string }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current as (HTMLElement & { reload?: () => void }) | null
    if (!el) return
    let timer = 0
    const onFail = (e: Event) => {
      const code = (e as Event & { errorCode?: number }).errorCode
      if (code === -3) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => el.reload?.(), 1500)
    }
    el.addEventListener('did-fail-load', onFail)
    return () => {
      window.clearTimeout(timer)
      el.removeEventListener('did-fail-load', onFail)
    }
  }, [src])
  return <webview ref={ref} src={src} partition={partition} style={{ flex: 1, width: '100%' }} />
}

/**
 * A live picture of the app's real window. Clicking it moves the window exactly
 * over the picture and brings it forward, so you use the app right here; click
 * anywhere else in Hangar and the picture is back on top.
 */
function WindowMirror({ project, running }: { project: Project; running: boolean }) {
  const toast = useToast()
  const [list, setList] = useState<WindowList | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [hasFrame, setHasFrame] = useState(false)
  /** The window's real size in points, so the picture shows 1:1 (only ever shrunk to fit). */
  const [natural, setNatural] = useState<number | null>(null)
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!running) return
    let alive = true
    const tick = async () => {
      try {
        const l = await api.previewWindows(project.id)
        if (!alive) return
        setList(l)
        setSourceId((cur) => (cur && l.windows.some((w) => w.id === cur) ? cur : l.windows[0]?.id ?? null))
      } catch {
        /* try again next tick */
      }
    }
    void tick()
    const t = window.setInterval(tick, 1500)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [project.id, running])

  useEffect(() => {
    if (!sourceId) return
    let alive = true
    let stream: MediaStream | null = null
    setHasFrame(false)
    const constraints = { audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: 3840, maxHeight: 2400, maxFrameRate: 30 } } } as unknown as MediaStreamConstraints
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop())
        stream = s
        setStreamError(null)
        if (video.current) video.current.srcObject = s
        s.getVideoTracks()[0]?.addEventListener('ended', () => setSourceId(null))
      })
      .catch((e) => alive && setStreamError(errMsg(e)))
    return () => {
      alive = false
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [sourceId])

  const use = async () => {
    const el = video.current
    if (!el || !sourceId || !el.videoWidth) return
    const b = el.getBoundingClientRect()
    const ratio = el.videoWidth / el.videoHeight
    let w = b.width
    let h = b.height
    if (w / h > ratio) w = h * ratio
    else h = w / ratio
    const r = await api.previewFocusWindow(project.id, sourceId, { x: b.left + (b.width - w) / 2, y: b.top + (b.height - h) / 2, width: w, height: h })
    if (!r.ok) toast(r.message, false)
  }

  const needsPermission = list && list.permission !== 'granted' && list.permission !== 'unknown' && !list.windows.length
  if (needsPermission) {
    return (
      <div className="waiting">
        <ShieldAlert size={22} className="muted" />
        <h3 style={{ margin: 0, fontSize: 13 }}>Allow Hangar to show app windows</h3>
        <p>To show {project.name}’s window inside the preview, turn Hangar on in System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording, then reopen Hangar.</p>
        <button type="button" className="btn" onClick={() => api.openPrivacy('screen')}>Open Privacy Settings</button>
      </div>
    )
  }
  if (!sourceId) {
    return (
      <div className="waiting">
        <AppWindow size={22} className="muted" />
        <h3 style={{ margin: 0, fontSize: 13 }}>{running ? `Waiting for ${project.name}’s window…` : `Starting ${project.name}…`}</h3>
        <p>It shows up here as soon as the app opens it. The first run of a desktop app can take a while to build.</p>
      </div>
    )
  }
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      {list && list.windows.length > 1 && (
        <Seg label="Window" value={sourceId} onChange={setSourceId} options={list.windows.map((w, i) => ({ value: w.id, label: w.name || `Window ${i + 1}` }))} />
      )}
      {streamError ? (
        <div className="waiting">
          <h3 style={{ margin: 0, fontSize: 13 }}>Could not show the window</h3>
          <p className="selectable">{streamError}</p>
        </div>
      ) : (
        <button type="button" onClick={use} title="Click to use it here" style={{ position: 'relative', display: 'block', maxWidth: '100%', borderRadius: 8, overflow: 'hidden', boxShadow: 'var(--shadow)', border: '1px solid var(--line2)', background: 'var(--panel)', minWidth: 240, minHeight: 160 }}>
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            aria-label={`Live view of ${project.name}`}
            onLoadedData={(e) => {
              setHasFrame(true)
              setNatural(e.currentTarget.videoWidth / (window.devicePixelRatio || 1))
            }}
            onResize={(e) => setNatural(e.currentTarget.videoWidth / (window.devicePixelRatio || 1))}
            style={{ display: 'block', width: natural ?? undefined, maxWidth: '100%', height: 'auto', maxHeight: 680, objectFit: 'contain', background: 'var(--bg)' }}
          />
          {!hasFrame && (
            <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <Spinner size={18} />
            </span>
          )}
        </button>
      )}
      <p className="row muted" style={{ margin: 0, fontSize: 11.5, gap: 6 }}>
        <MousePointerClick size={12} /> Live view of {project.name}’s window. Click it to use the app right here; click anywhere else in Hangar to come back.
      </p>
    </div>
  )
}

function Waiting({ state, error, exited, logs, onRestart, label }: { state: PreviewState | null; error: string | null; exited: boolean; logs: string[]; onRestart: () => void; label?: string }) {
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
      <h3 style={{ margin: 0, fontSize: 13 }}>{state?.status === 'installing' ? 'Installing packages…' : label || 'Starting the dev server…'}</h3>
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
