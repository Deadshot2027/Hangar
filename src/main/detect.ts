import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Detection } from '@shared/types'

interface Pkg {
  name?: string
  description?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readPkg(dir: string): Pkg | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Pkg
  } catch {
    return null
  }
}

function listNames(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function packageManager(dir: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun'
  return 'npm'
}

export function scriptCommand(dir: string, script: string): string {
  const pm = packageManager(dir)
  if (pm === 'npm') return script === 'start' ? 'npm start' : `npm run ${script}`
  if (pm === 'bun') return `bun run ${script}`
  return `${pm} ${script}`
}

/** The install command for a folder whose node_modules is missing, or null. */
export function installCommand(dir: string): string | null {
  if (!existsSync(join(dir, 'package.json')) || existsSync(join(dir, 'node_modules'))) return null
  const pm = packageManager(dir)
  return pm === 'npm' ? 'npm install' : `${pm} install`
}

function readmeLine(dir: string): string | undefined {
  const file = listNames(dir).find((n) => /^readme(\.md|\.txt)?$/i.test(n))
  if (!file) return undefined
  try {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n')
    const line = lines.map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.startsWith('![') && !l.startsWith('<') && !l.startsWith('[!'))
    return line ? line.replace(/[*_`]/g, '').slice(0, 160) : undefined
  } catch {
    return undefined
  }
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function detectNode(dir: string, pkg: Pkg, prefix: string): Detection | null {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const scripts = pkg.scripts || {}
  const run = (s: string) => prefix + scriptCommand(dir, s)
  const description = pkg.description
  const tauri = existsSync(join(dir, 'src-tauri', 'tauri.conf.json')) || '@tauri-apps/cli' in deps || '@tauri-apps/api' in deps
  if (tauri) {
    const command = scripts.tauri ? run('tauri') + ' dev' : scripts.dev ? run('dev') : prefix + 'npx tauri dev'
    return { label: 'Tauri app', kind: 'desktop', command, url: 'http://localhost:5173', tags: ['desktop', 'tauri'], description }
  }
  if ('electron' in deps) {
    const command = scripts.dev ? run('dev') : scripts.start ? run('start') : prefix + 'npx electron .'
    return { label: 'Electron app', kind: 'desktop', command, tags: ['desktop', 'electron'], description }
  }
  if ('expo' in deps || 'react-native' in deps) {
    return { label: 'React Native app', kind: 'console', command: scripts.start ? run('start') : prefix + 'npx expo start', tags: ['mobile'], description }
  }
  if ('next' in deps) return { label: 'Next.js app', kind: 'web', command: run('dev'), url: 'http://localhost:3000', tags: ['web', 'next'], description }
  if ('astro' in deps) return { label: 'Astro site', kind: 'web', command: run('dev'), url: 'http://localhost:4321', tags: ['web', 'astro'], description }
  if ('@sveltejs/kit' in deps) return { label: 'SvelteKit app', kind: 'web', command: run('dev'), url: 'http://localhost:5173', tags: ['web', 'svelte'], description }
  if ('nuxt' in deps) return { label: 'Nuxt app', kind: 'web', command: run('dev'), url: 'http://localhost:3000', tags: ['web', 'nuxt'], description }
  if ('vite' in deps) {
    const tags = ['web']
    if ('react' in deps) tags.push('react')
    if ('three' in deps) tags.push('3d')
    return { label: 'react' in deps ? 'React app (Vite)' : 'Vite app', kind: 'web', command: scripts.dev ? run('dev') : prefix + 'npx vite', url: 'http://localhost:5173', tags, description }
  }
  const server = ['express', 'fastify', 'koa', 'hono'].some((d) => d in deps)
  if (scripts.dev) return { label: server ? 'Node server' : 'Node project', kind: server ? 'web' : 'console', command: run('dev'), tags: ['node'], description }
  if (scripts.start) return { label: server ? 'Node server' : 'Node project', kind: server ? 'web' : 'console', command: run('start'), tags: ['node'], description }
  return { label: 'Node project', kind: 'console', command: '', tags: ['node'], description }
}

/** Work out what a folder is and how to preview it. Fast: only reads a few files. */
export function detect(dir: string): Detection {
  const names = listNames(dir)
  const has = (n: string) => names.includes(n)
  const description = readmeLine(dir)
  const withDesc = (d: Detection): Detection => ({ ...d, description: d.description || description })

  // A launcher script at the top wins: it is how the author runs the project (QuantApp's run.sh).
  const runScript = has('run.sh') ? './run.sh' : has('dev.sh') ? './dev.sh' : ''

  const pkg = has('package.json') ? readPkg(dir) : null
  if (pkg) {
    const d = detectNode(dir, pkg, '')
    if (d) return withDesc(runScript ? { ...d, command: runScript } : d)
  }

  // A web front end in a sub-folder (frontend/, app/, web/, client/): QuantApp keeps its Tauri app in frontend/.
  for (const sub of ['frontend', 'app', 'web', 'client', 'ui']) {
    const subDir = join(dir, sub)
    if (!isDir(subDir)) continue
    const subPkg = readPkg(subDir)
    if (!subPkg) continue
    const d = detectNode(subDir, subPkg, `cd ${sub} && `)
    if (d) return withDesc(runScript ? { ...d, command: runScript } : d)
  }

  if (has('Package.swift')) return withDesc({ label: 'Swift package', kind: 'desktop', command: runScript || 'swift run', tags: ['swift', 'macos'] })
  if (names.some((n) => n.endsWith('.xcodeproj') || n.endsWith('.xcworkspace'))) {
    return withDesc({ label: 'Xcode project', kind: 'desktop', command: runScript, tags: ['xcode', 'apple'] })
  }
  if (has('Cargo.toml')) return withDesc({ label: 'Rust project', kind: 'console', command: runScript || 'cargo run', tags: ['rust'] })
  if (has('go.mod')) return withDesc({ label: 'Go project', kind: 'console', command: runScript || 'go run .', tags: ['go'] })
  if (has('project.godot')) return withDesc({ label: 'Godot game', kind: 'desktop', command: runScript || 'godot --path .', tags: ['game', 'godot'] })
  if (isDir(join(dir, 'ProjectSettings')) && isDir(join(dir, 'Assets'))) return withDesc({ label: 'Unity project', kind: 'desktop', command: runScript, tags: ['game', 'unity'] })

  const python = has('pyproject.toml') || has('requirements.txt') || has('setup.py') || names.some((n) => n.endsWith('.py'))
  if (python) {
    if (has('manage.py')) return withDesc({ label: 'Django app', kind: 'web', command: runScript || 'python3 manage.py runserver', url: 'http://localhost:8000', tags: ['python', 'web'] })
    const entry = ['main.py', 'app.py', 'bot.py', 'run.py'].find(has)
    return withDesc({ label: 'Python project', kind: 'console', command: runScript || (entry ? `python3 ${entry}` : ''), tags: ['python'] })
  }
  if (has('index.html')) {
    return withDesc({ label: 'Static site', kind: 'web', command: runScript || 'python3 -m http.server 8000', url: 'http://localhost:8000', tags: ['web'] })
  }
  if (runScript) return withDesc({ label: 'Project', kind: 'console', command: runScript, tags: [] })
  return withDesc({ label: 'Folder', kind: 'none', command: '', tags: [] })
}

/** Does this folder look like a project at all? (Used when scanning the Mac.) */
export function looksLikeProject(dir: string): boolean {
  const names = listNames(dir)
  const markers = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt', 'Package.swift', 'project.godot', 'index.html', 'run.sh']
  return names.some((n) => markers.includes(n) || n.endsWith('.xcodeproj'))
}
