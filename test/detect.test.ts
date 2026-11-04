import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detect, installCommand, looksLikeProject } from '../src/main/detect'
import { tempDir, write } from './helpers'

describe('detect', () => {
  it('finds a Vite + React app and its dev command', () => {
    const dir = tempDir()
    write(dir, { 'package.json': JSON.stringify({ description: 'My site', scripts: { dev: 'vite' }, dependencies: { react: '19' }, devDependencies: { vite: '6' } }) })
    const d = detect(dir)
    expect(d.label).toBe('React app (Vite)')
    expect(d.kind).toBe('web')
    expect(d.command).toBe('npm run dev')
    expect(d.url).toBe('http://localhost:5173')
    expect(d.description).toBe('My site')
  })

  it('uses the lockfile’s package manager', () => {
    const dir = tempDir()
    write(dir, { 'package.json': JSON.stringify({ scripts: { dev: 'next dev' }, dependencies: { next: '15' } }), 'pnpm-lock.yaml': '' })
    expect(detect(dir).command).toBe('pnpm dev')
  })

  it('finds a Tauri app kept in frontend/ and prefers the author’s run.sh', () => {
    const dir = tempDir()
    write(dir, {
      'run.sh': '#!/bin/bash\n',
      'frontend/package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '6', '@tauri-apps/cli': '2' } }),
      'frontend/src-tauri/tauri.conf.json': '{}',
      'README.md': '# Thing\n\nA native macOS app for research.\n'
    })
    const d = detect(dir)
    expect(d.label).toBe('Tauri app')
    expect(d.kind).toBe('desktop')
    expect(d.command).toBe('./run.sh')
    expect(d.description).toBe('A native macOS app for research.')
  })

  it('handles Python, static sites, Swift and empty folders', () => {
    const py = tempDir()
    write(py, { 'requirements.txt': 'requests\n', 'bot.py': 'print(1)\n' })
    expect(detect(py)).toMatchObject({ label: 'Python project', kind: 'console', command: 'python3 bot.py' })

    const site = tempDir()
    write(site, { 'index.html': '<h1>hi</h1>' })
    expect(detect(site)).toMatchObject({ label: 'Static site', kind: 'web', command: 'python3 -m http.server 8000' })

    const swift = tempDir()
    write(swift, { 'Package.swift': '// swift-tools-version:5.9' })
    expect(detect(swift)).toMatchObject({ label: 'Swift package', command: 'swift run' })

    expect(detect(tempDir())).toMatchObject({ label: 'Folder', kind: 'none', command: '' })
  })

  it('knows when packages still need installing', () => {
    const dir = tempDir()
    write(dir, { 'package.json': '{}', 'yarn.lock': '' })
    expect(installCommand(dir)).toBe('yarn install')
    write(dir, { 'node_modules/.keep': '' })
    expect(installCommand(dir)).toBeNull()
  })

  it('recognises project folders', () => {
    const dir = tempDir()
    expect(looksLikeProject(dir)).toBe(false)
    write(dir, { 'Cargo.toml': '' })
    expect(looksLikeProject(dir)).toBe(true)
  })

  it.runIf(existsSync('/home/user/quantapp/run.sh'))('reads the real QuantApp checkout as a Tauri app run by run.sh', () => {
    const d = detect('/home/user/quantapp')
    expect(d.label).toBe('Tauri app')
    expect(d.command).toBe('./run.sh')
  })
})
