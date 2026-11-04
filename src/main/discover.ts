import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FoundFolder } from '@shared/types'
import { detect, looksLikeProject } from './detect'
import * as git from './git'

const SKIP = new Set(['node_modules', 'Library', 'Applications', 'Pictures', 'Music', 'Movies', 'Public', 'vendor', 'target', 'dist', 'build'])

/** Where people usually keep code. Only the ones that exist are scanned. */
export function defaultRoots(): string[] {
  const h = homedir()
  return ['Developer', 'Projects', 'projects', 'Code', 'code', 'dev', 'src', 'repos', 'GitHub', 'Documents', 'Desktop'].map((d) => join(h, d))
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    const items = await readdir(dir, { withFileTypes: true })
    return items.filter((i) => i.isDirectory() && !i.name.startsWith('.') && !SKIP.has(i.name)).map((i) => join(dir, i.name))
  } catch {
    return []
  }
}

/**
 * Folders that look like projects (a git repo, package.json, Cargo.toml...)
 * up to two levels below the usual code folders, minus the ones already in Hangar.
 */
export async function discover(roots: string[], exclude: string[], limit = 30): Promise<FoundFolder[]> {
  const skip = new Set(exclude.map((p) => resolve(p)))
  const seen = new Set<string>()
  const hits: { path: string; mtime: number }[] = []

  const consider = async (dir: string, depth: number) => {
    const abs = resolve(dir)
    if (seen.has(abs) || skip.has(abs)) return
    seen.add(abs)
    if (looksLikeProject(abs)) {
      let m = 0
      try {
        m = (await stat(abs)).mtimeMs
      } catch {
        /* gone */
      }
      hits.push({ path: abs, mtime: m })
      return
    }
    if (depth < 2) for (const sub of await subdirs(abs)) await consider(sub, depth + 1)
  }

  for (const root of roots) {
    if (!existsSync(root) || skip.has(resolve(root))) continue
    for (const sub of await subdirs(root)) await consider(sub, 1)
  }

  hits.sort((a, b) => b.mtime - a.mtime)
  const top = hits.slice(0, limit)
  return Promise.all(
    top.map(async ({ path }) => {
      const isGit = git.isRepo(path)
      const hasRemote = isGit ? !!(await git.remoteUrl(path)) : false
      return { path, name: path.split('/').pop() || path, isGit, hasRemote, detection: detect(path) }
    })
  )
}
