import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as vault from '../src/main/vault'
import { within } from '../src/main/paths'
import { repoWithRemote, sh, tempDir, write } from './helpers'

describe('vault', () => {
  it('creates a project from a template with notes, assets, a repo and a first commit', async () => {
    const v = tempDir()
    const { project, warning } = await vault.createProject(v, { name: 'Arena IO', template: 'game', createRepo: false, visibility: 'private' })
    expect(warning).toBeNull()
    expect(project.id).toBe('arena-io')
    expect(project.codePath).toBe(join(v, 'arena-io', 'repo'))
    expect(project.isGit).toBe(true)
    expect(project.preview).toMatchObject({ command: 'python3 -m http.server 3000', kind: 'web' })
    expect(existsSync(join(v, 'arena-io', 'assets'))).toBe(true)
    expect(readFileSync(join(v, 'arena-io', 'notes.md'), 'utf8')).toBe('# Arena IO\n\n')
    expect(sh(project.codePath!, 'log', '--pretty=%s').trim()).toBe('Initial commit')

    const again = await vault.createProject(v, { name: 'Arena IO', template: 'blank', createRepo: false, visibility: 'private' })
    expect(again.project.id).toBe('arena-io-2')
    expect((await vault.listProjects(v)).map((p) => p.id)).toEqual(['arena-io', 'arena-io-2'])
  })

  it('links a folder where it is, detects it, and reads the GitHub remote', async () => {
    const v = tempDir()
    const { work } = repoWithRemote(tempDir(), { 'package.json': JSON.stringify({ description: 'Shop front', scripts: { dev: 'vite' }, devDependencies: { vite: '6' } }) })
    sh(work, 'remote', 'set-url', 'origin', 'git@github.com:me/shop.git')
    const p = await vault.linkFolder(v, work, false)
    expect(p.codePath).toBe(work)
    expect(p.description).toBe('Shop front')
    expect(p.preview.command).toBe('npm run dev')
    expect(p.remote?.fullName).toBe('me/shop')
    expect(existsSync(work)).toBe(true)
    const stored = JSON.parse(readFileSync(join(p.home, 'hangar.json'), 'utf8'))
    expect(stored.code).toBe(work)
  })

  it('moves a folder into the vault when asked', async () => {
    const v = tempDir()
    const src = join(tempDir(), 'scraper')
    write(src, { 'main.py': 'print(1)\n' })
    const p = await vault.linkFolder(v, src, true)
    expect(p.codePath).toBe(join(v, 'scraper', 'repo'))
    expect(existsSync(src)).toBe(false)
    expect(p.preview).toMatchObject({ command: 'python3 main.py', kind: 'console' })
  })

  it('updates hangar.json without losing other settings', async () => {
    const v = tempDir()
    const { project } = await vault.createProject(v, { name: 'Notes', template: 'web', createRepo: false, visibility: 'private' })
    const p = await vault.updateProject(v, project.id, { status: 'live', launch: { kind: 'url', target: 'example.com' } })
    expect(p.status).toBe('live')
    expect(p.launch).toEqual({ kind: 'url', target: 'example.com' })
    expect(p.preview.command).toBe('npm run dev')
    await vault.writeNotes(v, p.id, '# Hi\n- [ ] one\n')
    expect(await vault.readNotes(v, p.id)).toBe('# Hi\n- [ ] one\n')
  })

  it('uploads and deletes files, committing only those paths and pushing', async () => {
    const v = tempDir()
    const { work, bare } = repoWithRemote(tempDir(), { 'README.md': '# x', 'src/app.ts': 'x', 'old.txt': 'bye' })
    const linked = await vault.linkFolder(v, work, false)
    write(work, { 'README.md': '# work in progress' })

    const upload = join(tempDir(), 'shot.png')
    write(join(upload, '..'), { 'shot.png': 'png-bytes' })
    const up = await vault.uploadFiles(linked, 'src', [upload])
    expect(up).toEqual({ ok: true, message: 'Uploaded shot.png and pushed to GitHub.' })
    expect(sh(bare, 'log', '-1', '--pretty=%s').trim()).toBe('Add shot.png')
    expect(sh(bare, 'show', '--name-only', '--pretty=', 'HEAD').trim()).toBe('src/shot.png')

    const del = await vault.deletePath(linked, 'old.txt')
    expect(del.message).toBe('Deleted old.txt and pushed to GitHub.')
    expect(existsSync(join(work, 'old.txt'))).toBe(false)
    expect(sh(bare, 'log', '-1', '--pretty=%s').trim()).toBe('Delete old.txt')

    const st = sh(work, 'status', '--porcelain').trim()
    expect(st).toBe('M README.md')

    const files = await vault.listFiles(linked, '')
    expect(files.map((f) => f.name)).toEqual(['src', 'README.md'])
    expect(files[1]).toMatchObject({ status: 'M', lastCommit: { message: 'Initial commit' } })
    expect(files[0].lastCommit?.message).toBe('Add shot.png')
  })

  it('refuses paths outside the project', async () => {
    expect(() => within('/tmp/project', '../etc/passwd')).toThrow(/outside/)
    expect(() => within('/tmp/project', '/etc')).toThrow(/outside/)
    expect(within('/tmp/project', 'src/a.ts')).toBe('/tmp/project/src/a.ts')
    const v = tempDir()
    await expect(vault.getProject(v, '../x')).rejects.toThrow()
  })

  it('keeps assets beside the code, out of git', async () => {
    const v = tempDir()
    const { project } = await vault.createProject(v, { name: 'Clips', template: 'python', createRepo: false, visibility: 'private' })
    const src = join(tempDir(), 'intro.mov')
    write(join(src, '..'), { 'intro.mov': 'video' })
    expect((await vault.addAssets(v, project.id, [src])).message).toBe('Added intro.mov to assets.')
    expect((await vault.listAssets(v, project.id)).map((a) => a.name)).toEqual(['intro.mov'])
    expect(sh(project.codePath!, 'status', '--porcelain').trim()).toBe('')
  })
})
