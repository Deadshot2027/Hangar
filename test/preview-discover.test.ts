import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PreviewEvent, Project } from '@shared/types'
import { discover } from '../src/main/discover'
import { PreviewManager, findLocalUrl, stripAnsi } from '../src/main/preview'
import { sh, tempDir, write } from './helpers'

describe('local URL detection', () => {
  it('reads the URL out of dev server banners', () => {
    expect(findLocalUrl('  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m')).toBe('http://localhost:5173/')
    expect(findLocalUrl('Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...')).toBe('http://localhost:8000/')
    expect(findLocalUrl('ready - started server on http://127.0.0.1:3000.')).toBe('http://localhost:3000')
    expect(findLocalUrl('compiled successfully')).toBeNull()
    expect(stripAnsi('\x1b[1mbold\x1b[0m')).toBe('bold')
  })
})

function fakeProject(dir: string, command: string): Project {
  return {
    version: 1, name: 'Demo', status: 'building', description: '', tags: [], links: [], code: dir,
    preview: { command, kind: 'web' }, launch: { kind: 'none', target: '' }, createdAt: '',
    id: 'demo', home: dir, codePath: dir, codeExists: true, isGit: false, remote: null, updatedAt: ''
  }
}

describe('PreviewManager', () => {
  it('runs the command, reports the URL, and stops the process tree', async () => {
    const dir = tempDir()
    write(dir, { 'server.js': "console.log('  Local:   http://localhost:4321/'); setInterval(() => {}, 1000)\n" })
    const events: PreviewEvent[] = []
    const pm = new PreviewManager((e) => events.push(e))
    const state = pm.start(fakeProject(dir, 'node server.js'))
    expect(state.status).toBe('starting')
    await expect.poll(() => pm.state('demo').url, { timeout: 10_000 }).toBe('http://localhost:4321/')
    expect(events.some((e) => e.type === 'url')).toBe(true)
    expect(pm.state('demo').status).toBe('running')
    const pid = (pm as unknown as { procs: Map<string, { child: { pid: number } }> }).procs.get('demo')!.child.pid
    pm.stop('demo')
    expect(pm.state('demo').status).toBe('idle')
    await expect.poll(() => {
      try {
        process.kill(pid, 0)
        return 'alive'
      } catch {
        return 'gone'
      }
    }, { timeout: 5000 }).toBe('gone')
  })

  it('reports when the command exits', async () => {
    const dir = tempDir()
    const events: PreviewEvent[] = []
    const pm = new PreviewManager((e) => events.push(e))
    pm.start(fakeProject(dir, 'echo hello && exit 3'))
    await expect.poll(() => events.find((e) => e.type === 'status' && e.status === 'exited'), { timeout: 10_000 }).toBeTruthy()
    expect(events.filter((e) => e.type === 'log').map((e) => (e as { line: string }).line)).toContain('hello')
    expect(events.find((e) => e.type === 'status' && e.status === 'exited')).toMatchObject({ exitCode: 3 })
  })

  it('keeps a desktop app’s own windows hidden in interface view, and shows them for window view', async () => {
    const dir = tempDir()
    write(dir, { 'app.js': 'setInterval(() => {}, 1000)\n' })
    const hidden: number[][] = []
    const shown: number[][] = []
    const deps = {
      supported: true,
      tree: async (pid: number) => [pid, 111, 222],
      setHidden: async (pids: number[], h: boolean) => {
        ;(h ? hidden : shown).push(pids)
        return true
      }
    }
    const pm = new PreviewManager(() => undefined, deps)
    pm.start(fakeProject(dir, 'node app.js'), 'interface')
    await expect.poll(() => hidden.length, { timeout: 5000 }).toBeGreaterThan(0)
    expect(hidden[0]).toEqual([111, 222])
    await pm.setView('demo', 'window')
    expect(shown.at(-1)).toEqual([111, 222])
    const count = hidden.length
    await new Promise((r) => setTimeout(r, 1800))
    expect(hidden.length).toBe(count)
    expect(await pm.treePids('demo')).toContain(111)
    pm.stop('demo')
  })

  it('refuses to start without a command', () => {
    const pm = new PreviewManager(() => undefined)
    expect(() => pm.start(fakeProject(tempDir(), ''))).toThrow(/preview command/)
  })
})

describe('discover', () => {
  it('finds projects two levels down, skipping ones already in Hangar', async () => {
    const root = tempDir()
    write(root, {
      'game/index.html': '<canvas></canvas>',
      'org/api/package.json': JSON.stringify({ scripts: { dev: 'node .' } }),
      'org/notes.txt': 'not a project',
      'linked/main.py': 'print(1)',
      'node_modules/pkg/package.json': '{}'
    })
    sh(join(root, 'game'), 'init', '-q')
    const found = await discover([root], [join(root, 'linked')])
    const names = found.map((f) => f.name).sort()
    expect(names).toEqual(['api', 'game'])
    const game = found.find((f) => f.name === 'game')!
    expect(game).toMatchObject({ isGit: true, hasRemote: false })
    expect(game.detection.label).toBe('Static site')
  })
})

describe('preview progress', () => {
  it('reads stages, builds and the app starting out of the output', async () => {
    const { emptyProgress, readProgress } = await import('../src/main/preview')
    const p = emptyProgress()
    expect(readProgress(p, '=== Building backend sidecar (this can take a few minutes) ===')).toBe(true)
    expect(readProgress(p, '=== Building backend sidecar (this can take a few minutes) ===')).toBe(false)
    expect(readProgress(p, '==> Installing frontend dependencies')).toBe(true)
    expect(p.stages).toEqual(['Building backend sidecar (this can take a few minutes)', 'Installing frontend dependencies'])
    readProgress(p, '   Compiling serde v1.0.210')
    readProgress(p, '   Compiling tauri v2.1.0')
    expect(p).toMatchObject({ building: true, compiled: 2 })
    readProgress(p, '    Finished `dev` profile [unoptimized + debuginfo] target(s) in 41.20s')
    expect(p.building).toBe(false)
    readProgress(p, '     Running `target/debug/quantapp`')
    expect(p.appStarted).toBe(true)
    const q = emptyProgress()
    readProgress(q, '[12/80] Compiling Hangar main.swift')
    expect(q).toMatchObject({ building: true, compiled: 12, compiledTotal: 80 })
    expect(readProgress(q, 'GET /api/health 200')).toBe(false)
    expect(readProgress(q, '--- a/file.txt')).toBe(false)
  })

  it('waits until the page and the backends answer', async () => {
    const dir = tempDir()
    write(dir, { 'server.js': "console.log('Local: http://localhost:4400/'); setInterval(() => {}, 1000)\n" })
    const events: PreviewEvent[] = []
    let asked = 0
    const ready = { everyMs: 50, backends: () => ['http://127.0.0.1:8000'], probe: async (url: string) => (url.includes('8000') ? ++asked > 3 : true) }
    const pm = new PreviewManager((e) => events.push(e), undefined, ready)
    pm.start(fakeProject(dir, 'node server.js'))
    expect(pm.state('demo').progress.backends).toEqual([{ url: 'http://127.0.0.1:8000', up: false, auto: true }])
    await expect.poll(() => pm.state('demo').progress.pageUp, { timeout: 5000 }).toBe(true)
    await expect.poll(() => pm.state('demo').progress.backends[0].up, { timeout: 5000 }).toBe(true)
    expect(events.some((e) => e.type === 'progress' && e.progress.backends[0]?.up)).toBe(true)
    pm.stop('demo')
  })

  it('uses the backends set in Settings, and none for an empty list', () => {
    const dir = tempDir()
    write(dir, { 'app.js': 'setInterval(() => {}, 1000)\n' })
    const ready = { everyMs: 10_000, backends: () => ['http://127.0.0.1:9999'], probe: async () => false }
    const pm = new PreviewManager(() => undefined, undefined, ready)
    const set = { ...fakeProject(dir, 'node app.js'), preview: { command: 'node app.js', kind: 'web' as const, waitFor: ['http://localhost:7000/health'] } }
    expect(pm.start(set).progress.backends).toEqual([{ url: 'http://localhost:7000/health', up: false, auto: false }])
    pm.stop('demo')
    const none = { ...set, preview: { ...set.preview, waitFor: [] } }
    expect(pm.start(none).progress.backends).toEqual([])
    pm.stop('demo')
  })
})
