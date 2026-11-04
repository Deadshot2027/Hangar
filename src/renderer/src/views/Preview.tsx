import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ExternalLink, MousePointerClick, RotateCw, ShieldAlert, TerminalSquare } from 'lucide-react'
import type { DesktopView, PreviewState, Project, WindowList } from '@shared/types'
import { api, errMsg } from '../api'
import { Beads } from '../components/liquid'
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
  // The loading screen stays until the page in the box has loaded (and its backends answer), or the window shows.
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [windowReady, setWindowReady] = useState(false)
  const [forced, setForced] = useState(false)
  const [now, setNow] = useState(() => Date.now())
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
      if (e.type === 'progress') setState((s) => (s ? { ...s, progress: e.progress } : s))
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
    setForced(false)
    setLoadedAt(null)
    setWindowReady(false)
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
  // The page shows once the dev server printed its address, or once the project's address answers.
  const pageUrl = url || (state?.progress?.pageUp ? project.preview.url || null : null)
  const uiUrl = pageUrl
  const targets = useMemo(() => {
    if (kind === 'web') return ['browser'] as Target[]
    if (kind === 'desktop') return (project.preview.url || url ? ['interface', 'window'] : ['window']) as Target[]
    // Scripts can open windows too (pygame, Godot, a Tk app): offer the window view beside the output.
    return (url ? ['browser', 'output', 'window'] : ['output', 'window']) as Target[]
  }, [kind, url, project.preview.url])
  const active: Target = target && targets.includes(target) ? target : targets[0]

  useEffect(() => setLoadedAt(null), [pageUrl, reloadKey, active])
  const waiting = (state?.progress?.backends ?? []).filter((b) => !b.up)
  // A backend Hangar only guessed from the code stops holding the page 45s after it loaded: the guess may be wrong.
  const backendsReady = !waiting.length || (waiting.every((b) => b.auto) && loadedAt !== null && now - loadedAt > 45_000)
  const ready = forced || (active === 'window' ? windowReady : active === 'output' ? true : loadedAt !== null && backendsReady)
  const failed = !!error || state?.status === 'exited'
  const booting = canRun && !ready && !failed && active !== 'output'
  useEffect(() => {
    if (!booting) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [booting])
  // Remember how long it took, so next time the bar knows how far along it is.
  const bootKey = `hangar.boot.${project.id}.${active}`
  useEffect(() => {
    if (!ready || forced || !state?.startedAt) return
    const took = Date.now() - Date.parse(state.startedAt)
    try {
      if (took > 0 && took < 30 * 60_000) localStorage.setItem(bootKey, String(took))
    } catch {
      /* storage off: no estimate next time */
    }
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

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
        : booting
          ? 'Starting…'
          : url
            ? 'Live'
            : 'Running'
  const live = !error && !exited && !booting && (url || (status === 'running' && kind !== 'web'))
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
          {pageUrl &&
            !exited &&
            Array.from({ length: players }, (_, i) => {
              const multi = players > 1
              const vp = VIEWPORTS[viewport]
              const width = multi ? (viewport === 'phone' ? '300px' : 'calc(50% - 8px)') : vp.width
              const height = multi ? (players === 4 ? 300 : 460) : vp.height
              const src = multi ? `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}player=${i + 1}` : pageUrl
              return (
                <div key={`${i}-${reloadKey}`} className="device" style={{ width, maxWidth: '100%', height, flex: multi || viewport !== 'desktop' ? 'none' : '1 1 auto' }}>
                  <div className="device-bar">
                    <span style={{ fontWeight: 600, color: 'var(--tx2)' }}>{multi ? `Player ${i + 1}` : viewport === 'desktop' ? 'Desktop' : viewport === 'tablet' ? 'Tablet' : 'Phone'}</span>
                    <span className="mono ellipsis" style={{ fontSize: 10.5 }}>{src.replace(/^https?:\/\//, '')}</span>
                  </div>
                  <LivePage src={src} partition={`preview-${project.id}-${i}`} onLoaded={i === 0 ? () => setLoadedAt((t) => t ?? Date.now()) : undefined} />
                </div>
              )
            })}
          <Boot project={project} state={state} logs={logs} active={active} now={now} error={error} pageUrl={pageUrl} loaded={loadedAt !== null} windowReady={windowReady} done={!booting && !failed} bootKey={bootKey} onShowNow={() => setForced(true)} onOutput={() => setDockOpen(true)} onRestart={restart} />
        </div>
      )}

      {active === 'interface' && (
        <div className="stage">
          {uiUrl && !exited && !error && (
            <div className="device" style={{ width: '100%', height: 640, flex: '1 1 auto' }}>
              <div className="device-bar">
                <span style={{ fontWeight: 600, color: 'var(--tx2)' }}>{project.name}</span>
                <span className="ellipsis">its own window is hidden while you preview it here</span>
              </div>
              <LivePage key={reloadKey} src={uiUrl} partition={`preview-${project.id}-ui`} onLoaded={() => setLoadedAt((t) => t ?? Date.now())} />
            </div>
          )}
          <Boot project={project} state={state} logs={logs} active={active} now={now} error={error} pageUrl={pageUrl} loaded={loadedAt !== null} windowReady={windowReady} done={!booting && !failed} bootKey={bootKey} onShowNow={() => setForced(true)} onOutput={() => setDockOpen(true)} onRestart={restart} />
        </div>
      )}

      {active === 'window' && (
        <div className="stage center" style={{ minHeight: 480 }}>
          {!exited && !error && <WindowMirror project={project} running={running} onReady={setWindowReady} />}
          <Boot project={project} state={state} logs={logs} active={active} now={now} error={error} pageUrl={pageUrl} loaded={loadedAt !== null} windowReady={windowReady} done={!booting && !failed} bootKey={bootKey} onShowNow={() => setForced(true)} onOutput={() => setDockOpen(true)} onRestart={restart} />
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

/** A web page in the box that keeps retrying while its dev server is still coming up, and says when it has really loaded. */
function LivePage({ src, partition, onLoaded }: { src: string; partition: string; onLoaded?: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const loaded = useRef(onLoaded)
  loaded.current = onLoaded
  useEffect(() => {
    const el = ref.current as (HTMLElement & { reload?: () => void }) | null
    if (!el) return
    let timer = 0
    let failed = false
    const onStart = () => {
      failed = false
    }
    const onFail = (e: Event) => {
      const ev = e as Event & { errorCode?: number; isMainFrame?: boolean }
      if (ev.errorCode === -3 || ev.isMainFrame === false) return
      failed = true
      window.clearTimeout(timer)
      timer = window.setTimeout(() => el.reload?.(), 1200)
    }
    const onFinish = () => {
      if (!failed) loaded.current?.()
    }
    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-fail-load', onFail)
    el.addEventListener('did-finish-load', onFinish)
    return () => {
      window.clearTimeout(timer)
      el.removeEventListener('did-start-loading', onStart)
      el.removeEventListener('did-fail-load', onFail)
      el.removeEventListener('did-finish-load', onFinish)
    }
  }, [src])
  return <webview ref={ref} src={src} partition={partition} style={{ flex: 1, width: '100%' }} />
}

/**
 * A live picture of the app's real window. Clicking it moves the window exactly
 * over the picture and brings it forward, so you use the app right here; click
 * anywhere else in Hangar and the picture is back on top.
 */
function WindowMirror({ project, running, onReady }: { project: Project; running: boolean; onReady: (ready: boolean) => void }) {
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

  const needsPermission = !!list && list.permission !== 'granted' && list.permission !== 'unknown' && !list.windows.length
  // The loading screen goes once there is a picture, or something to say instead of one.
  const showing = needsPermission || !!streamError || (!!sourceId && hasFrame)
  useEffect(() => onReady(showing), [showing, onReady])
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
  if (!sourceId) return <div aria-hidden="true" style={{ minHeight: 360 }} />
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
          {!hasFrame && <span style={{ position: 'absolute', inset: 0 }} />}
        </button>
      )}
      <p className="row muted" style={{ margin: 0, fontSize: 11.5, gap: 6 }}>
        <MousePointerClick size={12} /> Live view of {project.name}’s window. Click it to use the app right here; click anywhere else in Hangar to come back.
      </p>
    </div>
  )
}

interface BootStep {
  key: string
  label: string
  detail?: string
  done: boolean
  /** Steps that happen one after another: a later one done means this one is too. */
  seq?: boolean
}

const hostOf = (u: string | null | undefined) => (u ? u.replace(/^https?:\/\//, '').replace(/\/$/, '') : '')

/** "Building backend sidecar (this can take a few minutes -- …)" → the name, and the aside. */
function splitStage(text: string): [string, string | undefined] {
  const m = text.match(/^(.*?)\s*(?:\((.+)\)|\s--\s(.+))\s*$/)
  return m && m[1] ? [m[1], (m[2] || m[3] || '').trim() || undefined] : [text, undefined]
}

function bootSteps(project: Project, st: PreviewState | null, active: Target, f: { pageUrl: string | null; loaded: boolean; windowReady: boolean }): BootStep[] {
  const p = st?.progress
  if (!st || !p) return [{ key: 'start', label: 'Starting', done: false, seq: true }]
  const steps: BootStep[] = []
  const desktop = project.preview.kind === 'desktop'
  const showsPage = active === 'browser' || active === 'interface'
  if (p.install) steps.push({ key: 'install', label: 'Installing packages', done: st.status !== 'installing', seq: true })
  p.stages.forEach((text, i) => {
    const [label, detail] = splitStage(text)
    steps.push({ key: `stage${i}`, label, detail, done: i < p.stages.length - 1, seq: true })
  })
  if (showsPage) steps.push({ key: 'server', label: desktop ? 'Starting its interface' : 'Starting the dev server', detail: hostOf(f.pageUrl || project.preview.url), done: !!f.pageUrl, seq: true })
  if (p.compiled > 0 || p.building) {
    steps.push({ key: 'build', label: 'Compiling', detail: p.compiledTotal ? `${p.compiled} of ${p.compiledTotal}` : `${p.compiled} crate${p.compiled === 1 ? '' : 's'}`, done: !p.building, seq: true })
  }
  if (desktop && (active === 'window' || p.appStarted || p.compiled > 0)) steps.push({ key: 'app', label: 'Starting the app', done: p.appStarted || f.windowReady, seq: true })
  for (const b of p.backends) steps.push({ key: `be:${b.url}`, label: p.backends.length > 1 ? 'Waiting for a backend' : 'Waiting for the backend', detail: hostOf(b.url), done: b.up })
  if (showsPage) steps.push({ key: 'page', label: active === 'interface' ? 'Loading the interface' : 'Loading the page', done: f.loaded })
  if (active === 'window') steps.push({ key: 'win', label: 'Showing its window', done: f.windowReady })
  let later = false
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].done) later = true
    else if (later && steps[i].seq) steps[i].done = true
  }
  return steps
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const TICK = (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7.4 5.9 10.2 11 4.4" />
  </svg>
)

/**
 * The preview's loading screen: glass over the box while the app comes up,
 * with the liquid beads, what it is doing now (read from its output, and by
 * asking its page and backends), how long it took last time, and the latest
 * line it printed. It dissolves into the page once everything answers.
 */
function Boot(props: {
  project: Project
  state: PreviewState | null
  logs: string[]
  active: Target
  now: number
  error: string | null
  pageUrl: string | null
  loaded: boolean
  windowReady: boolean
  done: boolean
  bootKey: string
  onShowNow: () => void
  onOutput: () => void
  onRestart: () => void
}) {
  const { project, state, logs, active, now, error, pageUrl, loaded, windowReady, done, bootKey } = props
  const { go } = useApp()
  const exited = state?.status === 'exited'
  const steps = useMemo(() => bootSteps(project, state, active, { pageUrl, loaded, windowReady }), [project, state, active, pageUrl, loaded, windowReady])
  const expected = useMemo(() => {
    try {
      return Number(localStorage.getItem(bootKey)) || 0
    } catch {
      return 0
    }
  }, [bootKey])

  if (error || exited) {
    const tail = logs.filter((l) => !l.startsWith('$ ')).slice(-6).join('\n')
    return (
      <div className="boot" role="alert">
        <div className="boot-card bad">
          <div className="boot-top">
            <div className="boot-title">
              <h3>{error ? 'The preview could not start' : `The preview stopped${state?.exitCode != null ? ` (exit ${state.exitCode})` : ''}`}</h3>
              <p>{error ? 'Hangar could not run its preview command.' : 'Its command ended. The last thing it printed:'}</p>
            </div>
          </div>
          <pre className="boot-why mono">{error || tail || 'It exited without printing anything.'}</pre>
          <div className="boot-foot">
            <button type="button" className="btn pri sm" onClick={props.onRestart}>
              <RotateCw size={11} /> Try again
            </button>
            <button type="button" className="btn sm" onClick={props.onOutput}>
              Output
            </button>
            <span className="grow" />
            <button type="button" className="text-btn" onClick={() => go({ kind: 'project', id: project.id, tab: 'settings' })}>
              Preview settings
            </button>
          </div>
        </div>
      </div>
    )
  }

  const startedAt = state?.startedAt ? Date.parse(state.startedAt) : now
  const elapsed = Math.max(0, now - startedAt)
  const current = steps.find((s) => !s.done)
  const backendWait = current?.key.startsWith('be:') && loaded
  const tail = [...logs].reverse().find((l) => l.trim() && !l.startsWith('$ '))
  const pct = expected ? Math.min(96, (elapsed / expected) * 100) : 0
  return (
    <div className={done ? 'boot done' : 'boot'} aria-hidden={done} role="status" aria-label={`Starting ${project.name}`}>
      <div className="boot-card">
        <div className="boot-top">
          <Beads />
          <div className="boot-title">
            <h3>Starting {project.name}</h3>
            <p>{current ? `${current.label}…` : 'Almost there…'}</p>
          </div>
          <span className="boot-time mono" title={expected ? `Last time it took ${clock(expected)}` : undefined}>
            {clock(elapsed)}
            {expected ? <span className="muted"> / ~{clock(expected)}</span> : null}
          </span>
        </div>
        <div className={expected ? 'boot-bar' : 'boot-bar sweep'} aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </div>
        <ol className="boot-steps">
          {steps.map((s) => (
            <li key={s.key} className={`boot-step ${s.done ? 'ok' : s === current ? 'now' : ''}`}>
              <span className="ico">{s.done ? TICK : s === current ? <Spinner size={11} /> : <span className="ring" />}</span>
              <span className="grow ellipsis">{s.label}</span>
              {s.detail && <span className="detail mono ellipsis">{s.detail}</span>}
            </li>
          ))}
        </ol>
        <div className="boot-tail mono">{tail && <span key={tail} className="ellipsis">{tail}</span>}</div>
        <div className="boot-foot">
          <span className="grow ellipsis">{backendWait ? 'The page is up.' : elapsed > 20_000 && !expected ? 'The first run can take a while.' : ''}</span>
          {backendWait && (
            <button type="button" className="text-btn" title="Choose what the preview waits for" onClick={() => go({ kind: 'project', id: project.id, tab: 'settings' })}>
              Wait for…
            </button>
          )}
          <button type="button" className="text-btn" onClick={props.onOutput}>
            Output
          </button>
          {(elapsed > 3000 || loaded) && (
            <button type="button" className="btn sm" onClick={props.onShowNow}>
              Show it now
            </button>
          )}
        </div>
      </div>
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
