import type { GhRepo, Release, RepoInfo } from '@shared/types'
import { run, runOk, which } from './exec'

// Hangar talks to GitHub through the GitHub CLI (`gh`), so it never stores a
// token itself: sign in once with `gh auth login` and Hangar uses that.

const GH_ENV = { GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1' }

const gh = (args: string[], cwd?: string, timeout = 120_000) => run('gh', args, { cwd, env: GH_ENV, timeout })
const ghOk = (args: string[], cwd?: string, timeout = 120_000) => runOk('gh', args, { cwd, env: GH_ENV, timeout })

export async function ghStatus(): Promise<{ installed: boolean; loggedIn: boolean; user: string | null }> {
  if (!(await which('gh'))) return { installed: false, loggedIn: false, user: null }
  const r = await gh(['api', 'user', '--jq', '.login'], undefined, 15_000)
  const user = r.code === 0 ? r.stdout.trim() || null : null
  return { installed: true, loggedIn: !!user, user }
}

function explain(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err)
  if (/ENOENT|not found|command not found/i.test(msg) && /gh/.test(msg)) {
    return new Error('The GitHub CLI is not installed. Install it with `brew install gh`, then run `gh auth login`.')
  }
  if (/auth login|not logged|authentication/i.test(msg)) return new Error('Sign in to GitHub first: run `gh auth login` in Terminal.')
  if (/delete_repo/i.test(msg)) {
    return new Error('Deleting needs one more permission. Run `gh auth refresh -h github.com -s delete_repo` in Terminal, then try again.')
  }
  return err instanceof Error ? err : new Error(msg)
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    throw explain(e)
  }
}

interface RawRepo {
  nameWithOwner: string
  name: string
  description: string | null
  isPrivate: boolean
  updatedAt: string
  primaryLanguage: { name: string } | null
  url: string
}

export function listRepos(): Promise<GhRepo[]> {
  return guard(async () => {
    const out = await ghOk(['repo', 'list', '--limit', '200', '--json', 'nameWithOwner,name,description,isPrivate,updatedAt,primaryLanguage,url'])
    const rows = JSON.parse(out) as RawRepo[]
    return rows.map((r) => ({
      fullName: r.nameWithOwner,
      name: r.name,
      description: r.description || '',
      isPrivate: r.isPrivate,
      updatedAt: r.updatedAt,
      language: r.primaryLanguage?.name || '',
      url: r.url
    }))
  })
}

export function clone(fullName: string, dest: string): Promise<void> {
  return guard(async () => {
    await ghOk(['repo', 'clone', fullName, dest, '--', '--quiet'], undefined, 600_000)
  })
}

/** Create a GitHub repo from a local folder that already has a commit, and push it. */
export function createFromSource(dir: string, name: string, visibility: 'private' | 'public'): Promise<void> {
  return guard(async () => {
    await ghOk(['repo', 'create', name, `--${visibility}`, '--source', dir, '--remote', 'origin', '--push'], dir, 300_000)
  })
}

export function view(fullName: string): Promise<RepoInfo> {
  return guard(async () => {
    const out = await ghOk(['repo', 'view', fullName, '--json', 'nameWithOwner,name,url,visibility,isArchived,description'])
    const r = JSON.parse(out) as { nameWithOwner: string; name: string; url: string; visibility: RepoInfo['visibility']; isArchived: boolean; description: string | null }
    return { fullName: r.nameWithOwner, name: r.name, url: r.url, visibility: r.visibility, isArchived: r.isArchived, description: r.description || '' }
  })
}

export function rename(fullName: string, newName: string): Promise<void> {
  return guard(async () => {
    await ghOk(['repo', 'rename', newName, '--repo', fullName, '--yes'])
  })
}

export function setVisibility(fullName: string, visibility: 'private' | 'public'): Promise<void> {
  return guard(async () => {
    await ghOk(['repo', 'edit', fullName, '--visibility', visibility, '--accept-visibility-change-consequences'])
  })
}

export function setArchived(fullName: string, archived: boolean): Promise<void> {
  return guard(async () => {
    await ghOk(['repo', archived ? 'archive' : 'unarchive', fullName, '--yes'])
  })
}

export function deleteRepo(fullName: string): Promise<void> {
  return guard(async () => {
    await ghOk(['repo', 'delete', fullName, '--yes'])
  })
}

export function releases(fullName: string): Promise<Release[]> {
  return guard(async () => {
    const out = await ghOk(['release', 'list', '--repo', fullName, '--limit', '10', '--json', 'tagName,name,isDraft,publishedAt'])
    const rows = JSON.parse(out) as { tagName: string; name: string; isDraft: boolean; publishedAt: string | null }[]
    return Promise.all(
      rows.map(async (r) => {
        const detail = await gh(['release', 'view', r.tagName, '--repo', fullName, '--json', 'assets'])
        let assets: Release['assets'] = []
        if (detail.code === 0) {
          const parsed = JSON.parse(detail.stdout) as { assets: { name: string; size: number }[] }
          assets = parsed.assets.map((a) => ({ name: a.name, size: a.size }))
        }
        return { tag: r.tagName, name: r.name || r.tagName, isDraft: r.isDraft, publishedAt: r.publishedAt && !r.publishedAt.startsWith('0001') ? r.publishedAt : null, assets }
      })
    )
  })
}

export function createRelease(fullName: string, tag: string, title: string, notes: string): Promise<void> {
  return guard(async () => {
    await ghOk(['release', 'create', tag, '--repo', fullName, '--draft', '--title', title || tag, '--notes', notes || ''])
  })
}

export function uploadAssets(fullName: string, tag: string, paths: string[]): Promise<void> {
  return guard(async () => {
    await ghOk(['release', 'upload', tag, ...paths, '--repo', fullName, '--clobber'], undefined, 900_000)
  })
}

export function publishRelease(fullName: string, tag: string): Promise<void> {
  return guard(async () => {
    await ghOk(['release', 'edit', tag, '--repo', fullName, '--draft=false'])
  })
}
