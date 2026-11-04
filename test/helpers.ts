import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// Commits in tests need an identity, whatever the machine's git config says.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 'Hangar Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Hangar Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1'
})

export function tempDir(prefix = 'hangar-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function write(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
}

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** A repo with one commit, pushed to a local bare repo that plays the part of GitHub. */
export function repoWithRemote(root: string, files: Record<string, string>): { work: string; bare: string } {
  const bare = join(root, 'remote.git')
  const work = join(root, 'work')
  mkdirSync(work, { recursive: true })
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  sh(work, 'init', '-q', '-b', 'main')
  write(work, files)
  sh(work, 'add', '-A')
  sh(work, 'commit', '-q', '-m', 'Initial commit')
  sh(work, 'remote', 'add', 'origin', bare)
  sh(work, 'push', '-q', '-u', 'origin', 'main')
  return { work, bare }
}
