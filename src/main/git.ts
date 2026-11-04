import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Change, Commit, GitStatus, Remote } from '@shared/types'
import { cleanError, run, runOk } from './exec'

const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }

function git(dir: string, args: string[], timeout = 120_000) {
  return run('git', args, { cwd: dir, env: GIT_ENV, timeout })
}

function gitOk(dir: string, args: string[], timeout = 120_000) {
  return runOk('git', args, { cwd: dir, env: GIT_ENV, timeout })
}

export function isRepo(dir: string | null): boolean {
  return !!dir && existsSync(join(dir, '.git'))
}

export async function remoteUrl(dir: string): Promise<string | null> {
  const r = await git(dir, ['config', '--get', 'remote.origin.url'], 10_000)
  return r.code === 0 ? r.stdout.trim() || null : null
}

/** github.com remotes in any of git's spellings: https, ssh, scp-style. */
export function parseRemote(url: string | null): Remote | null {
  if (!url) return null
  const m = url.trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i)
  if (!m) return null
  const [, owner, name] = m
  return { owner, name, fullName: `${owner}/${name}`, url: `https://github.com/${owner}/${name}` }
}

function changeCode(xy: string): Change['code'] {
  if (xy === '??') return '?'
  if (xy.includes('D')) return 'D'
  if (xy.includes('R')) return 'R'
  if (xy.includes('A')) return 'A'
  return 'M'
}

export function parseStatus(out: string): Omit<GitStatus, 'isGit'> {
  const lines = out.split('\n').filter(Boolean)
  let branch = ''
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const changes: Change[] = []
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const head = line.slice(3)
      const noCommits = head.match(/^No commits yet on (.+)$/)
      if (noCommits) {
        branch = noCommits[1]
        continue
      }
      const m = head.match(/^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/)
      if (m) {
        branch = m[1] === 'HEAD (no branch)' ? 'detached' : m[1]
        upstream = m[2] || null
        const info = m[3] || ''
        ahead = Number(info.match(/ahead (\d+)/)?.[1] || 0)
        behind = Number(info.match(/behind (\d+)/)?.[1] || 0)
      }
      continue
    }
    const xy = line.slice(0, 2)
    let path = line.slice(3)
    if (path.includes(' -> ')) path = path.split(' -> ')[1]
    path = path.replace(/^"(.*)"$/, '$1')
    changes.push({ code: changeCode(xy), path })
  }
  return { branch, upstream, ahead, behind, changes }
}

export async function status(dir: string | null): Promise<GitStatus> {
  if (!dir || !isRepo(dir)) return { isGit: false, branch: '', upstream: null, ahead: 0, behind: 0, changes: [] }
  const out = await gitOk(dir, ['status', '--porcelain=v1', '-b'], 30_000)
  return { isGit: true, ...parseStatus(out) }
}

const SEP = '\x1f'

export async function log(dir: string | null, limit = 20): Promise<Commit[]> {
  if (!dir || !isRepo(dir)) return []
  const r = await git(dir, ['log', `-n${limit}`, `--pretty=format:%h${SEP}%s${SEP}%cr${SEP}%an`], 30_000)
  if (r.code !== 0) return []
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, message, when, author] = l.split(SEP)
      return { sha, message, when, author }
    })
}

export async function lastCommitFor(dir: string, rel: string): Promise<Commit | null> {
  const r = await git(dir, ['log', '-1', `--pretty=format:%h${SEP}%s${SEP}%cr${SEP}%an`, '--', rel], 15_000)
  if (r.code !== 0 || !r.stdout.trim()) return null
  const [sha, message, when, author] = r.stdout.trim().split(SEP)
  return { sha, message, when, author }
}

export async function branches(dir: string): Promise<string[]> {
  const r = await git(dir, ['branch', '--format=%(refname:short)'], 15_000)
  return r.code === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : []
}

export async function checkout(dir: string, branch: string, create: boolean): Promise<void> {
  if (!/^[\w./-]+$/.test(branch) || branch.startsWith('-')) throw new Error('That is not a valid branch name.')
  await gitOk(dir, create ? ['switch', '-c', branch] : ['switch', branch])
}

export async function hasUpstream(dir: string): Promise<boolean> {
  const r = await git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 10_000)
  return r.code === 0
}

export async function pull(dir: string): Promise<string> {
  if (!(await remoteUrl(dir))) return 'This repo has no remote to pull from.'
  if (!(await hasUpstream(dir))) return 'This branch is not on GitHub yet, so there is nothing to pull.'
  const out = await gitOk(dir, ['pull', '--ff-only'])
  return /Already up to date/i.test(out) ? 'Already up to date.' : 'Pulled the latest changes.'
}

/** Push the current branch, rebasing once onto the remote if the push was rejected. */
export async function push(dir: string): Promise<string> {
  if (!(await remoteUrl(dir))) return 'Committed. There is no GitHub remote yet, so nothing was pushed.'
  const upstream = await hasUpstream(dir)
  const args = upstream ? ['push'] : ['push', '-u', 'origin', 'HEAD']
  let r = await git(dir, args)
  if (r.code !== 0 && /rejected|fetch first|non-fast-forward/i.test(r.stderr)) {
    const rebase = await git(dir, ['pull', '--rebase', '--autostash'])
    if (rebase.code !== 0) {
      await git(dir, ['rebase', '--abort'])
      throw new Error('GitHub has newer changes that conflict with yours. Open the project in Claude Code or your editor to merge them.')
    }
    r = await git(dir, args)
  }
  if (r.code !== 0) throw new Error(cleanError(r.stderr) || 'Push failed.')
  return 'Pushed to GitHub.'
}

export async function commitAll(dir: string, message: string): Promise<void> {
  await gitOk(dir, ['add', '-A'])
  await gitOk(dir, ['commit', '-q', '-m', message])
}

/** Stage and commit only these paths, leaving any other work in progress alone. */
export async function commitPaths(dir: string, message: string, paths: string[]): Promise<void> {
  await gitOk(dir, ['add', '-A', '--', ...paths])
  await gitOk(dir, ['commit', '-q', '-m', message, '--', ...paths])
}

export async function isTracked(dir: string, rel: string): Promise<boolean> {
  const r = await git(dir, ['ls-files', '--', rel], 15_000)
  return r.code === 0 && r.stdout.trim().length > 0
}

export async function init(dir: string): Promise<void> {
  const r = await git(dir, ['init', '-q', '-b', 'main'])
  if (r.code !== 0) await gitOk(dir, ['init', '-q'])
}

export async function hasCommits(dir: string): Promise<boolean> {
  return (await git(dir, ['rev-parse', '--verify', 'HEAD'], 10_000)).code === 0
}

export async function setRemote(dir: string, url: string): Promise<void> {
  const existing = await remoteUrl(dir)
  await gitOk(dir, existing ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url])
}

export async function removeRemote(dir: string): Promise<void> {
  await git(dir, ['remote', 'remove', 'origin'], 10_000)
}

export async function clone(url: string, dest: string): Promise<void> {
  await runOk('git', ['clone', '--quiet', url, dest], { env: GIT_ENV, timeout: 600_000 })
}
