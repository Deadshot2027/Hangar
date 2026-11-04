import { spawn, type ChildProcess } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { DesktopView, PreviewEvent, PreviewProgress, PreviewState, Project } from '@shared/types'
import { canManageWindows, processTree, setHidden } from './appwindows'
import { detectBackends, installCommand } from './detect'

/** How the manager finds and hides the app windows a preview opens (swapped out in tests). */
export interface WindowDeps {
  supported: boolean
  tree: (pid: number) => Promise<number[]>
  setHidden: (pids: number[], hidden: boolean) => Promise<boolean>
}

const macWindows: WindowDeps = { supported: canManageWindows, tree: processTree, setHidden }

/** Does anything answer at this address? Any reply below 500 counts: a backend with no page at / still answers 404. */
export function probe(url: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      resolve(ok)
    }
    try {
      const req = (url.startsWith('https:') ? httpsRequest : httpRequest)(url, { method: 'GET', timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
        res.resume()
        finish((res.statusCode || 0) < 500)
      })
      req.on('timeout', () => {
        req.destroy()
        finish(false)
      })
      req.on('error', () => finish(false))
      req.end()
    } catch {
      finish(false)
    }
  })
}

/** How the manager asks addresses and finds backends (swapped out in tests). */
export interface ReadyDeps {
  probe: (url: string) => Promise<boolean>
  backends: (dir: string, pageUrl: string | null) => string[]
  everyMs: number
}
const realReady: ReadyDeps = { probe, backends: detectBackends, everyMs: 700 }

const origin = (u: string | null) => {
  try {
    return u ? new URL(u).origin.replace('127.0.0.1', 'localhost') : ''
  } catch {
    return ''
  }
}

export function emptyProgress(): PreviewProgress {
  return { install: false, stages: [], building: false, compiled: 0, compiledTotal: null, appStarted: false, pageUp: false, backends: [] }
}

const BANNER = /^\s*(?:={3,}|#{3,}|\*{3,}|==>)\s*(.*?[A-Za-z].*?)\s*(?:={3,}|#{3,}|\*{3,})?\s*$/
const CARGO_COMPILING = /^\s*Compiling [\w.-]+ v\d/
const CARGO_FINISHED = /^\s*Finished\b.*\b(?:target|profile)\b/
const APP_RUNNING = /^\s*Running `[^`]*target[\\/]|start electron app|^\s*Launching\b.*\.app\b/i
const STEP_COUNT = /^\s*\[(\d+)\/(\d+)\]\s+(?:Compiling|Linking|Build|Write|Emitting|Generating|Copying)/
const BUILD_DONE = /^\s*(?:Build complete!|\*\* BUILD SUCCEEDED \*\*)/

/** Read one line of output into the progress. Pure; true when something changed. */
export function readProgress(p: PreviewProgress, line: string): boolean {
  const banner = line.match(BANNER)
  if (banner && banner[1].length <= 160) {
    const text = banner[1].replace(/\s*=+$/, '').trim()
    if (text && p.stages.at(-1) !== text) {
      p.stages.push(text)
      if (p.stages.length > 12) p.stages.splice(0, p.stages.length - 12)
      return true
    }
    return false
  }
  if (CARGO_COMPILING.test(line)) {
    p.building = true
    p.compiled++
    return true
  }
  const step = line.match(STEP_COUNT)
  if (step) {
    p.building = true
    p.compiled = Number(step[1])
    p.compiledTotal = Number(step[2])
    return true
  }
  if (CARGO_FINISHED.test(line) || BUILD_DONE.test(line)) {
    const changed = p.building
    p.building = false
    return changed
  }
  if (APP_RUNNING.test(line) && !p.appStarted) {
    p.appStarted = true
    p.building = false
    return true
  }
  return false
}

/** Each new process gets this many tries at hiding its windows (they can appear a little after it starts). */
const HIDE_TRIES = 12
const HIDE_EVERY_MS = 1500

// The Preview tab runs a project's dev command and streams its output. The UI
// starts a preview when the tab opens and stops it when the tab closes, so at
// most one dev server is normally running.

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g
const URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{2,5})?(?:\/[^\s'"`<>)]*)?/i
const MAX_LOGS = 500

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '')
}

/** The first local URL a dev server prints, normalised to localhost. */
export function findLocalUrl(line: string): string | null {
  const m = stripAnsi(line).match(URL_RE)
  if (!m) return null
  return m[0].replace('0.0.0.0', 'localhost').replace('127.0.0.1', 'localhost').replace(/[.,;:]+$/, '')
}

interface Running {
  child: ChildProcess
  state: PreviewState
  stopping: boolean
  view: DesktopView | null
  hidden: Set<number>
  tries: Map<number, number>
  timer: NodeJS.Timeout | null
  /** The address the preview shows (from the output, else the project's setting). */
  pageUrl: string | null
  readyTimer: NodeJS.Timeout | null
}

export class PreviewManager {
  private procs = new Map<string, Running>()

  constructor(
    private send: (e: PreviewEvent) => void,
    private win: WindowDeps = macWindows,
    private ready: ReadyDeps = realReady
  ) {}

  private sendProgress(entry: Running) {
    this.send({ id: entry.state.id, type: 'progress', progress: { ...entry.state.progress, stages: [...entry.state.progress.stages], backends: entry.state.progress.backends.map((b) => ({ ...b })) } })
  }

  /** Keep asking the page and each backend until they answer. */
  private startAsking(entry: Running) {
    let busy = false
    const tick = async () => {
      if (busy || entry.stopping) return
      busy = true
      try {
        const p = entry.state.progress
        const url = entry.state.url || entry.pageUrl
        let changed = false
        const checks: Promise<void>[] = []
        if (url && !p.pageUp) checks.push(this.ready.probe(url).then((ok) => void (ok && !p.pageUp && ((p.pageUp = true), (changed = true)))))
        for (const b of p.backends) if (!b.up) checks.push(this.ready.probe(b.url).then((ok) => void (ok && !b.up && ((b.up = true), (changed = true)))))
        await Promise.all(checks)
        if (entry.stopping) return
        if (changed) this.sendProgress(entry)
        if ((p.pageUp || !url) && p.backends.every((b) => b.up) && entry.readyTimer) {
          clearInterval(entry.readyTimer)
          entry.readyTimer = null
        }
      } finally {
        busy = false
      }
    }
    entry.readyTimer = setInterval(() => void tick(), this.ready.everyMs)
    void tick()
  }

  private stopAsking(entry: Running) {
    if (entry.readyTimer) clearInterval(entry.readyTimer)
    entry.readyTimer = null
  }

  /** Every process this preview is running: the shell, the dev server, the app itself. */
  async treePids(id: string): Promise<number[]> {
    const pid = this.procs.get(id)?.child.pid
    return pid ? this.win.tree(pid) : []
  }

  /** Interface: keep the app's own windows hidden. Window: show them again so they can be mirrored. */
  async setView(id: string, view: DesktopView): Promise<void> {
    const entry = this.procs.get(id)
    if (!entry) return
    entry.view = view
    if (view === 'interface') return this.startHiding(entry)
    this.stopHiding(entry)
    if (entry.hidden.size) await this.win.setHidden([...entry.hidden], false)
    entry.hidden.clear()
    entry.tries.clear()
  }

  private startHiding(entry: Running) {
    if (!this.win.supported || entry.timer) return
    const tick = async () => {
      const root = entry.child.pid
      if (!root || entry.stopping || entry.view !== 'interface') return
      const pids = (await this.win.tree(root)).filter((p) => p !== root && (entry.tries.get(p) || 0) < HIDE_TRIES)
      if (!pids.length) return
      for (const p of pids) entry.tries.set(p, (entry.tries.get(p) || 0) + 1)
      await this.win.setHidden(pids, true)
      for (const p of pids) entry.hidden.add(p)
    }
    entry.timer = setInterval(() => void tick(), HIDE_EVERY_MS)
    void tick()
  }

  private stopHiding(entry: Running) {
    if (entry.timer) clearInterval(entry.timer)
    entry.timer = null
  }

  state(id: string): PreviewState {
    return this.procs.get(id)?.state ?? { id, status: 'idle', command: '', url: null, logs: [], exitCode: null, startedAt: null, progress: emptyProgress() }
  }

  start(project: Project, view?: DesktopView): PreviewState {
    const existing = this.procs.get(project.id)
    if (existing && existing.state.status !== 'exited') {
      if (view && view !== existing.view) void this.setView(project.id, view)
      return existing.state
    }
    const cwd = project.codePath
    const command = project.preview.command.trim()
    if (!cwd || !project.codeExists) throw new Error('This project has no code folder to run.')
    if (!command) throw new Error('Set a preview command in Settings first.')

    // A Node project that was never installed gets `npm install` first.
    const install = installCommand(cwd)
    const full = install ? `${install} && ${command}` : command
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
    const child = spawn(shell, ['-lc', full], {
      cwd,
      detached: process.platform !== 'win32',
      // BROWSER=none stops dev servers opening a browser tab; PYTHONUNBUFFERED makes Python print its URL straight away.
      env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0', NO_COLOR: '1', PYTHONUNBUFFERED: '1' }
    })

    const pageUrl = project.preview.kind === 'console' ? null : project.preview.url || null
    const progress = emptyProgress()
    progress.install = !!install
    let backends: string[] = []
    try {
      backends = project.preview.waitFor ?? (project.preview.kind === 'console' ? [] : this.ready.backends(cwd, pageUrl))
    } catch {
      /* unreadable code folder: wait for nothing */
    }
    progress.backends = backends.filter(Boolean).map((url) => ({ url, up: false, auto: !project.preview.waitFor }))
    const state: PreviewState = {
      id: project.id,
      status: install ? 'installing' : 'starting',
      command: full,
      url: null,
      logs: [`$ ${full}`],
      exitCode: null,
      startedAt: new Date().toISOString(),
      progress
    }
    const entry: Running = { child, state, stopping: false, view: view ?? null, hidden: new Set(), tries: new Map(), timer: null, pageUrl, readyTimer: null }
    this.procs.set(project.id, entry)
    if (entry.view === 'interface') this.startHiding(entry)
    if (pageUrl || progress.backends.length) this.startAsking(entry)
    this.send({ id: project.id, type: 'status', status: state.status })
    this.send({ id: project.id, type: 'log', line: state.logs[0] })

    let buffer = ''
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const raw of lines) this.line(entry, raw, command)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (err) => this.line(entry, `Could not start: ${err.message}`, command))
    child.on('exit', (code) => {
      this.stopHiding(entry)
      this.stopAsking(entry)
      if (buffer) this.line(entry, buffer, command)
      entry.state.status = 'exited'
      entry.state.exitCode = code
      if (!entry.stopping) this.send({ id: project.id, type: 'status', status: 'exited', exitCode: code })
      // A restart may already have put a new run under this id: only clear our own.
      if (this.procs.get(project.id) === entry) this.procs.delete(project.id)
    })
    return state
  }

  private line(entry: Running, raw: string, command: string) {
    // What a stopped run prints on its way out is not news.
    if (entry.stopping) return
    const line = stripAnsi(raw).trimEnd()
    if (!line) return
    const { state } = entry
    state.logs.push(line)
    if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS)
    this.send({ id: state.id, type: 'log', line })
    if (readProgress(state.progress, line)) this.sendProgress(entry)
    if (state.status === 'installing' && (/^(added|removed|changed) \d+ packages?|up to date|Done in|Lockfile is up to date|Packages: \+\d+/i.test(line) || line.includes(command))) {
      state.status = 'starting'
      this.send({ id: state.id, type: 'status', status: 'starting' })
    }
    const url = state.url ? null : findLocalUrl(line)
    if (url) {
      state.url = url
      // The page is somewhere other than the setting said (a busy port moved it): ask there instead.
      if (state.progress.pageUp && origin(url) !== origin(entry.pageUrl)) {
        state.progress.pageUp = false
        this.sendProgress(entry)
      }
      if (!entry.readyTimer && !state.progress.pageUp) this.startAsking(entry)
      state.status = 'running'
      this.send({ id: state.id, type: 'url', url })
      this.send({ id: state.id, type: 'status', status: 'running' })
    } else if (state.status !== 'running' && state.status !== 'installing' && state.logs.length > 2) {
      state.status = 'running'
      this.send({ id: state.id, type: 'status', status: 'running' })
    }
  }

  /** Stop the dev server and everything it started (vite, electron, tauri...). */
  stop(id: string): void {
    const entry = this.procs.get(id)
    if (!entry) {
      // Nothing running, but say so: the UI may still think it is.
      this.send({ id, type: 'status', status: 'idle' })
      return
    }
    entry.stopping = true
    this.stopHiding(entry)
    this.stopAsking(entry)
    const pid = entry.child.pid
    const kill = (sig: NodeJS.Signals) => {
      try {
        if (pid && process.platform !== 'win32') process.kill(-pid, sig)
        else entry.child.kill(sig)
      } catch {
        /* already gone */
      }
    }
    kill('SIGTERM')
    setTimeout(() => kill('SIGKILL'), 3000).unref()
    this.procs.delete(id)
    this.send({ id, type: 'status', status: 'idle' })
  }

  stopAll(): void {
    for (const id of [...this.procs.keys()]) this.stop(id)
  }
}
