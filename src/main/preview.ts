import { spawn, type ChildProcess } from 'node:child_process'
import type { PreviewEvent, PreviewState, Project } from '@shared/types'
import { installCommand } from './detect'

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
}

export class PreviewManager {
  private procs = new Map<string, Running>()

  constructor(private send: (e: PreviewEvent) => void) {}

  state(id: string): PreviewState {
    return this.procs.get(id)?.state ?? { id, status: 'idle', command: '', url: null, logs: [], exitCode: null, startedAt: null }
  }

  start(project: Project): PreviewState {
    const existing = this.procs.get(project.id)
    if (existing && existing.state.status !== 'exited') return existing.state
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

    const state: PreviewState = {
      id: project.id,
      status: install ? 'installing' : 'starting',
      command: full,
      url: null,
      logs: [`$ ${full}`],
      exitCode: null,
      startedAt: new Date().toISOString()
    }
    const entry: Running = { child, state, stopping: false }
    this.procs.set(project.id, entry)
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
      if (buffer) this.line(entry, buffer, command)
      entry.state.status = 'exited'
      entry.state.exitCode = code
      if (!entry.stopping) this.send({ id: project.id, type: 'status', status: 'exited', exitCode: code })
      this.procs.delete(project.id)
    })
    return state
  }

  private line(entry: Running, raw: string, command: string) {
    const line = stripAnsi(raw).trimEnd()
    if (!line) return
    const { state } = entry
    state.logs.push(line)
    if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS)
    this.send({ id: state.id, type: 'log', line })
    if (state.status === 'installing' && (/^(added|removed|changed) \d+ packages?|up to date|Done in|Lockfile is up to date|Packages: \+\d+/i.test(line) || line.includes(command))) {
      state.status = 'starting'
      this.send({ id: state.id, type: 'status', status: 'starting' })
    }
    const url = state.url ? null : findLocalUrl(line)
    if (url) {
      state.url = url
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
    if (!entry) return
    entry.stopping = true
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
