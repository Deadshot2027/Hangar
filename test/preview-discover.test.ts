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
