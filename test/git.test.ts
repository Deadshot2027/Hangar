import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as git from '../src/main/git'
import { repoWithRemote, sh, tempDir, write } from './helpers'

describe('parseRemote', () => {
  it('reads every spelling of a GitHub remote', () => {
    for (const url of ['https://github.com/me/app.git', 'https://github.com/me/app', 'git@github.com:me/app.git', 'ssh://git@github.com/me/app.git']) {
      expect(git.parseRemote(url)).toEqual({ owner: 'me', name: 'app', fullName: 'me/app', url: 'https://github.com/me/app' })
    }
    expect(git.parseRemote('https://gitlab.com/me/app.git')).toBeNull()
    expect(git.parseRemote(null)).toBeNull()
  })
})

describe('parseStatus', () => {
  it('reads branch, upstream, ahead/behind and changes', () => {
    const s = git.parseStatus('## main...origin/main [ahead 2, behind 1]\n M src/a.ts\nA  b.ts\n D c.ts\n?? new/\nR  old.ts -> d.ts\n')
    expect(s).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 })
    expect(s.changes).toEqual([
      { code: 'M', path: 'src/a.ts' },
      { code: 'A', path: 'b.ts' },
      { code: 'D', path: 'c.ts' },
      { code: '?', path: 'new/' },
      { code: 'R', path: 'd.ts' }
    ])
  })

  it('handles a repo with no commits and a branch with no upstream', () => {
    expect(git.parseStatus('## No commits yet on main\n')).toMatchObject({ branch: 'main', upstream: null })
    expect(git.parseStatus('## feature\n')).toMatchObject({ branch: 'feature', upstream: null, ahead: 0 })
  })
})

describe('git operations', () => {
  it('commits only the given paths and pushes', async () => {
    const { work, bare } = repoWithRemote(tempDir(), { 'a.txt': 'a', 'b.txt': 'b' })
    write(work, { 'a.txt': 'changed', 'new.txt': 'new' })
    await git.commitPaths(work, 'Add new.txt', ['new.txt'])
    expect(await git.push(work)).toBe('Pushed to GitHub.')
    const st = await git.status(work)
    expect(st.changes).toEqual([{ code: 'M', path: 'a.txt' }])
    expect(sh(bare, 'log', '-1', '--pretty=%s').trim()).toBe('Add new.txt')
  })

  it('rebases onto newer remote commits before pushing', async () => {
    const root = tempDir()
    const { work, bare } = repoWithRemote(root, { 'a.txt': 'a' })
    const other = join(root, 'other')
    sh(root, 'clone', '-q', bare, other)
    write(other, { 'z.txt': 'from elsewhere' })
    sh(other, 'add', '-A')
    sh(other, 'commit', '-q', '-m', 'Elsewhere')
    sh(other, 'push', '-q')

    write(work, { 'b.txt': 'b' })
    await git.commitPaths(work, 'Add b', ['b.txt'])
    expect(await git.push(work)).toBe('Pushed to GitHub.')
    expect(sh(bare, 'log', '--pretty=%s').trim().split('\n')).toEqual(['Add b', 'Elsewhere', 'Initial commit'])
  })

  it('pushes a new branch with an upstream, lists branches and reads history', async () => {
    const { work } = repoWithRemote(tempDir(), { 'a.txt': 'a' })
    await git.checkout(work, 'feature-1', true)
    write(work, { 'f.txt': 'f' })
    await git.commitAll(work, 'Feature work')
    expect(await git.hasUpstream(work)).toBe(false)
    await git.push(work)
    expect(await git.hasUpstream(work)).toBe(true)
    expect((await git.branches(work)).sort()).toEqual(['feature-1', 'main'])
    const history = await git.log(work, 5)
    expect(history.map((c) => c.message)).toEqual(['Feature work', 'Initial commit'])
    expect(await git.pull(work)).toBe('Already up to date.')
    await expect(git.checkout(work, '--evil', false)).rejects.toThrow(/valid branch/)
  })

  it('reports clearly when there is no remote', async () => {
    const dir = tempDir()
    await git.init(dir)
    write(dir, { 'x.txt': 'x' })
    await git.commitAll(dir, 'First')
    expect(await git.pull(dir)).toMatch(/no remote/)
    expect(await git.push(dir)).toMatch(/no GitHub remote/)
    expect(await git.status(null)).toMatchObject({ isGit: false })
  })
})
