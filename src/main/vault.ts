import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import type { ActionResult, FileEntry, HangarFile, NewProjectInput, Project } from '@shared/types'
import { detect } from './detect'
import * as git from './git'
import * as github from './github'
import { absoluteCode, expandHome, prettyName, slugify, within } from './paths'

// The vault is one folder (~/Hangar by default). Each project is a sub-folder:
//
//   <vault>/<id>/hangar.json   name, status, links, preview and launch settings
//   <vault>/<id>/notes.md      the project's notes
//   <vault>/<id>/assets/       big files that do not belong in git
//   <vault>/<id>/repo/         the code, when Hangar cloned or created it
//
// A folder added from elsewhere on the Mac stays where it is: hangar.json
// records its absolute path in `code` and the vault folder holds only the notes
// and assets. Nothing is hidden in a database.

export const HANGAR_FILE = 'hangar.json'

export function defaults(name: string): HangarFile {
  return {
    version: 1,
    name,
    status: 'building',
    description: '',
    tags: [],
    links: [],
    code: null,
    preview: { command: '', kind: 'none' },
    launch: { kind: 'none', target: '' },
    createdAt: new Date().toISOString()
  }
}

function normalize(raw: Partial<HangarFile>, fallbackName: string): HangarFile {
  const d = defaults(raw.name || fallbackName)
  return {
    ...d,
    ...raw,
    version: 1,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    links: Array.isArray(raw.links) ? raw.links : [],
    preview: { ...d.preview, ...(raw.preview || {}) },
    launch: { ...d.launch, ...(raw.launch || {}) }
  }
}

async function readHangar(home: string): Promise<HangarFile | null> {
  try {
    const raw = JSON.parse(await readFile(join(home, HANGAR_FILE), 'utf8')) as Partial<HangarFile>
    return normalize(raw, basename(home))
  } catch {
    return null
  }
}

async function writeHangar(home: string, data: HangarFile): Promise<void> {
  await writeFile(join(home, HANGAR_FILE), JSON.stringify(data, null, 2) + '\n', 'utf8')
}

async function mtime(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return 0
  }
}

async function hydrate(vault: string, id: string, data: HangarFile): Promise<Project> {
  const home = join(vault, id)
  const codePath = absoluteCode(home, data.code)
  const codeExists = !!codePath && existsSync(codePath)
  const isGit = codeExists && git.isRepo(codePath)
  const remote = isGit ? git.parseRemote(await git.remoteUrl(codePath!)) : null
  const touched = Math.max(await mtime(join(home, HANGAR_FILE)), await mtime(join(home, 'notes.md')), isGit ? await mtime(join(codePath!, '.git', 'index')) : 0)
  return { ...data, id, home, codePath, codeExists, isGit, remote, updatedAt: new Date(touched || Date.now()).toISOString() }
}

export async function ensureVault(vault: string): Promise<void> {
  await mkdir(vault, { recursive: true })
}

export async function getProject(vault: string, id: string): Promise<Project> {
  const home = within(vault, id)
  const data = await readHangar(home)
  if (!data) throw new Error(`No project called "${id}" in ${vault}.`)
  return hydrate(vault, id, data)
}

export async function listProjects(vault: string): Promise<Project[]> {
  await ensureVault(vault)
  const entries = await readdir(vault, { withFileTypes: true })
  const projects: Project[] = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const data = await readHangar(join(vault, e.name))
    if (data) projects.push(await hydrate(vault, e.name, data))
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name))
}

export async function updateProject(vault: string, id: string, patch: Partial<HangarFile>): Promise<Project> {
  const home = within(vault, id)
  const data = await readHangar(home)
  if (!data) throw new Error(`No project called "${id}".`)
  const next = normalize({ ...data, ...patch, preview: { ...data.preview, ...(patch.preview || {}) }, launch: { ...data.launch, ...(patch.launch || {}) } }, data.name)
  await writeHangar(home, next)
  return hydrate(vault, id, next)
}

/** A fresh, unused folder name in the vault for this project name. */
export function uniqueId(vault: string, name: string): string {
  const base = slugify(name)
  let id = base
  for (let i = 2; existsSync(join(vault, id)); i++) id = `${base}-${i}`
  return id
}

async function makeHome(vault: string, name: string): Promise<{ id: string; home: string }> {
  await ensureVault(vault)
  const id = uniqueId(vault, name)
  const home = join(vault, id)
  await mkdir(join(home, 'assets'), { recursive: true })
  await writeFile(join(home, 'notes.md'), `# ${name}\n\n`, 'utf8')
  return { id, home }
}

function fromDetection(data: HangarFile, codePath: string): HangarFile {
  const d = detect(codePath)
  return {
    ...data,
    description: data.description || d.description || '',
    tags: data.tags.length ? data.tags : d.tags,
    preview: { command: d.command, kind: d.kind, url: d.url }
  }
}

// ---------------------------------------------------------------- templates

const TEMPLATES: Record<NewProjectInput['template'], (name: string) => { files: Record<string, string>; preview: HangarFile['preview']; tags: string[] }> = {
  blank: (name) => ({
    files: { 'README.md': `# ${name}\n`, '.gitignore': 'node_modules/\n.DS_Store\n' },
    preview: { command: '', kind: 'none' },
    tags: []
  }),
  web: (name) => ({
    files: {
      'README.md': `# ${name}\n\nRun \`npm install\` once, then \`npm run dev\`.\n`,
      '.gitignore': 'node_modules/\ndist/\n.DS_Store\n',
      'package.json': JSON.stringify({ name: slugify(name), private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build' }, devDependencies: { vite: '^6.3.5' } }, null, 2) + '\n',
      'index.html': `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>${name}</title>\n    <link rel="stylesheet" href="/style.css" />\n  </head>\n  <body>\n    <main>\n      <h1>${name}</h1>\n      <p>Edit index.html and save. The preview reloads by itself.</p>\n    </main>\n    <script type="module" src="/main.js"></script>\n  </body>\n</html>\n`,
      'style.css': 'body { margin: 0; font-family: system-ui, sans-serif; background: #0b0c10; color: #e8eaef; }\nmain { max-width: 640px; margin: 15vh auto; padding: 0 24px; }\n',
      'main.js': "console.log('Hello from the dev server')\n"
    },
    preview: { command: 'npm run dev', kind: 'web', url: 'http://localhost:5173' },
    tags: ['web']
  }),
  game: (name) => ({
    files: {
      'README.md': `# ${name}\n\nOpen the Preview tab in Hangar, or run \`python3 -m http.server 3000\`.\n`,
      '.gitignore': '.DS_Store\n',
      'index.html': `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>${name}</title>\n    <style>html,body{margin:0;height:100%;background:#0b0c10;overflow:hidden}canvas{display:block}</style>\n  </head>\n  <body>\n    <canvas id="game"></canvas>\n    <script src="game.js"></script>\n  </body>\n</html>\n`,
      'game.js': `// Move with the arrow keys or WASD.\nconst canvas = document.getElementById('game')\nconst ctx = canvas.getContext('2d')\nconst keys = new Set()\nconst me = { x: 200, y: 200, r: 16 }\naddEventListener('keydown', (e) => keys.add(e.key.toLowerCase()))\naddEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))\nfunction resize() { canvas.width = innerWidth; canvas.height = innerHeight }\naddEventListener('resize', resize)\nresize()\nfunction frame() {\n  const s = 4\n  if (keys.has('arrowleft') || keys.has('a')) me.x -= s\n  if (keys.has('arrowright') || keys.has('d')) me.x += s\n  if (keys.has('arrowup') || keys.has('w')) me.y -= s\n  if (keys.has('arrowdown') || keys.has('s')) me.y += s\n  ctx.fillStyle = '#0b0c10'\n  ctx.fillRect(0, 0, canvas.width, canvas.height)\n  ctx.strokeStyle = '#1c1e24'\n  for (let x = 0; x < canvas.width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke() }\n  for (let y = 0; y < canvas.height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke() }\n  ctx.fillStyle = '#e8eaef'\n  ctx.beginPath(); ctx.arc(me.x, me.y, me.r, 0, Math.PI * 2); ctx.fill()\n  requestAnimationFrame(frame)\n}\nframe()\n`
    },
    preview: { command: 'python3 -m http.server 3000', kind: 'web', url: 'http://localhost:3000' },
    tags: ['game', 'web']
  }),
  python: (name) => ({
    files: { 'README.md': `# ${name}\n\nRun \`python3 main.py\`.\n`, '.gitignore': '__pycache__/\n.venv/\n.DS_Store\n', 'main.py': `print("Hello from ${name.replace(/"/g, '')}")\n` },
    preview: { command: 'python3 main.py', kind: 'console' },
    tags: ['python']
  })
}

export async function createProject(vault: string, input: NewProjectInput): Promise<{ project: Project; warning: string | null }> {
  const name = input.name.trim()
  if (!name) throw new Error('Give the project a name.')
  const { id, home } = await makeHome(vault, name)
  const repo = join(home, 'repo')
  const tpl = TEMPLATES[input.template](name)
  await mkdir(repo, { recursive: true })
  for (const [file, body] of Object.entries(tpl.files)) await writeFile(join(repo, file), body, 'utf8')
  await writeHangar(home, { ...defaults(name), status: 'idea', code: 'repo', tags: tpl.tags, preview: tpl.preview })

  let warning: string | null = null
  try {
    await git.init(repo)
    await git.commitAll(repo, 'Initial commit')
    if (input.createRepo) await github.createFromSource(repo, id, input.visibility)
  } catch (e) {
    warning = `The project is ready, but ${input.createRepo ? 'the GitHub repo' : 'git'} could not be set up: ${(e as Error).message}`
  }
  return { project: await getProject(vault, id), warning }
}

/** Add a folder from anywhere on the Mac. `move` puts it inside the vault; otherwise it stays put. */
export async function linkFolder(vault: string, folder: string, move: boolean): Promise<Project> {
  const src = expandHome(folder.trim())
  if (!existsSync(src) || !(await stat(src)).isDirectory()) throw new Error('That folder does not exist.')
  const name = prettyName(basename(src))
  const { id, home } = await makeHome(vault, name)
  let code: string = src
  if (move) {
    const dest = join(home, 'repo')
    try {
      await rename(src, dest)
    } catch {
      await cp(src, dest, { recursive: true })
      await rm(src, { recursive: true, force: true })
    }
    code = 'repo'
  }
  const codePath = absoluteCode(home, code)!
  await writeHangar(home, fromDetection({ ...defaults(name), code }, codePath))
  return getProject(vault, id)
}

export async function cloneRepo(vault: string, fullName: string, description = ''): Promise<Project> {
  const repoName = fullName.split('/')[1] || fullName
  const name = prettyName(repoName)
  const { id, home } = await makeHome(vault, name)
  const dest = join(home, 'repo')
  try {
    await github.clone(fullName, dest)
  } catch (e) {
    await rm(home, { recursive: true, force: true })
    throw e
  }
  await writeHangar(home, fromDetection({ ...defaults(name), code: 'repo', description }, dest))
  return getProject(vault, id)
}

/** Remove a project from Hangar. Its folder goes to the Trash (so nothing is lost); linked code is never touched. */
export async function removeProject(vault: string, id: string, trash: (path: string) => Promise<void>): Promise<void> {
  const home = within(vault, id)
  if (!existsSync(join(home, HANGAR_FILE))) throw new Error('That is not a Hangar project folder.')
  await trash(home)
}

// ---------------------------------------------------------------- notes and files

export async function readNotes(vault: string, id: string): Promise<string> {
  try {
    return await readFile(join(within(vault, id), 'notes.md'), 'utf8')
  } catch {
    return ''
  }
}

export async function writeNotes(vault: string, id: string, text: string): Promise<void> {
  await writeFile(join(within(vault, id), 'notes.md'), text, 'utf8')
}

async function entriesOf(dir: string, root: string): Promise<FileEntry[]> {
  const items = await readdir(dir, { withFileTypes: true })
  const out: FileEntry[] = []
  for (const it of items) {
    if (it.name === '.git' || it.name === '.DS_Store') continue
    const abs = join(dir, it.name)
    let size = 0
    try {
      size = it.isDirectory() ? 0 : (await stat(abs)).size
    } catch {
      /* broken link */
    }
    out.push({ name: it.name, path: relative(root, abs), isDir: it.isDirectory(), size })
  }
  return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.isDir ? -1 : 1))
}

/** One folder of the project's code, with each entry's last commit and git status. */
export async function listFiles(project: Project, rel: string): Promise<FileEntry[]> {
  if (!project.codePath || !project.codeExists) return []
  const dir = within(project.codePath, rel)
  const entries = await entriesOf(dir, project.codePath)
  if (!project.isGit) return entries
  const st = await git.status(project.codePath)
  const codes = new Map(st.changes.map((c) => [c.path.replace(/\/$/, ''), c.code]))
  const limited = entries.slice(0, 80)
  await Promise.all(
    limited.map(async (e) => {
      const c = await git.lastCommitFor(project.codePath!, e.path)
      if (c) e.lastCommit = { sha: c.sha, message: c.message, when: c.when }
      const direct = codes.get(e.path)
      const nested = e.isDir ? [...codes.entries()].find(([p]) => p.startsWith(e.path + '/'))?.[1] : undefined
      const code = direct || nested
      if (code) e.status = code
    })
  )
  return entries
}

export async function listAssets(vault: string, id: string): Promise<FileEntry[]> {
  const dir = join(within(vault, id), 'assets')
  await mkdir(dir, { recursive: true })
  return entriesOf(dir, dir)
}

export async function addAssets(vault: string, id: string, paths: string[]): Promise<ActionResult> {
  const dir = join(within(vault, id), 'assets')
  await mkdir(dir, { recursive: true })
  for (const p of paths) await cp(p, join(dir, basename(p)), { recursive: true })
  return { ok: true, message: paths.length === 1 ? `Added ${basename(paths[0])} to assets.` : `Added ${paths.length} files to assets.` }
}

function describe(names: string[]): string {
  return names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} more`
}

/** Copy files into the code, then commit just those files and push. */
export async function uploadFiles(project: Project, rel: string, paths: string[]): Promise<ActionResult> {
  if (!project.codePath || !project.codeExists) throw new Error('This project has no code folder yet.')
  const dest = within(project.codePath, rel)
  const added: string[] = []
  for (const p of paths) {
    const target = join(dest, basename(p))
    within(project.codePath, relative(project.codePath, target))
    await cp(p, target, { recursive: true, force: true })
    added.push(relative(project.codePath, target))
  }
  const label = describe(added.map((a) => basename(a)))
  if (!project.isGit) return { ok: true, message: `Copied ${label} into the project.` }
  await git.commitPaths(project.codePath, `Add ${label}`, added)
  try {
    const pushed = await git.push(project.codePath)
    return { ok: true, message: pushed.startsWith('Pushed') ? `Uploaded ${label} and pushed to GitHub.` : `Committed ${label}. ${pushed.replace(/^Committed\. /, '')}` }
  } catch (e) {
    return { ok: false, message: `Committed ${label}, but the push failed: ${(e as Error).message}` }
  }
}

/** Delete a file or folder, then commit the deletion and push. */
export async function deletePath(project: Project, rel: string): Promise<ActionResult> {
  if (!project.codePath) throw new Error('This project has no code folder.')
  if (!rel) throw new Error('Choose a file or folder to delete.')
  const abs = within(project.codePath, rel)
  const label = basename(rel)
  const tracked = project.isGit && (await git.isTracked(project.codePath, rel))
  await rm(abs, { recursive: true, force: true })
  if (!tracked) return { ok: true, message: `Deleted ${label}.` }
  await git.commitPaths(project.codePath, `Delete ${label}`, [rel])
  try {
    const pushed = await git.push(project.codePath)
    return { ok: true, message: pushed.startsWith('Pushed') ? `Deleted ${label} and pushed to GitHub.` : `Deleted ${label} and committed. ${pushed.replace(/^Committed\. /, '')}` }
  } catch (e) {
    return { ok: false, message: `Deleted and committed ${label}, but the push failed: ${(e as Error).message}` }
  }
}

/** Turn a project's code into a GitHub repo (initialising git and a first commit when needed). */
export async function createRepo(project: Project, visibility: 'private' | 'public'): Promise<void> {
  let codePath = project.codePath
  if (!codePath) {
    codePath = join(project.home, 'repo')
    await mkdir(codePath, { recursive: true })
    await writeFile(join(codePath, 'README.md'), `# ${project.name}\n`, 'utf8')
    const data = await readHangar(project.home)
    if (data) await writeHangar(project.home, { ...data, code: 'repo' })
  }
  if (!git.isRepo(codePath)) await git.init(codePath)
  if (!(await git.hasCommits(codePath))) await git.commitAll(codePath, 'Initial commit')
  if (await git.remoteUrl(codePath)) throw new Error('This project already has a remote.')
  await github.createFromSource(codePath, slugify(project.name), visibility)
}
