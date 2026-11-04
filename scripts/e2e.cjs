#!/usr/bin/env node
// End-to-end check of the built app: starts the real Hangar (out/) against a
// throwaway vault, adds projects through the UI, previews them, writes notes,
// commits and pushes, and saves a screenshot of each screen.
//
//   npm run build && node scripts/e2e.cjs ./e2e-shots
//   (on Linux without a display: xvfb-run -a node scripts/e2e.cjs ./e2e-shots)
//
// Needs Playwright (`npm i -D playwright`, or set PLAYWRIGHT to its path) and python3.
// GitHub is replaced by a fake signed-out `gh` and a local bare repo, so nothing
// touches a real account.
const { _electron } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const APP = path.resolve(__dirname, '..')
const OUT = path.resolve(process.argv[2] || path.join(APP, 'e2e-shots'))
fs.mkdirSync(OUT, { recursive: true })
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hangar-e2e-'))
const vault = path.join(root, 'Hangar')
const ident = { GIT_AUTHOR_NAME: 'Hangar Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Hangar Test', GIT_COMMITTER_EMAIL: 't@example.com' }
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env: { ...process.env, ...ident }, encoding: 'utf8' })
const write = (dir, files) => {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), body)
  }
}

// A signed-out GitHub CLI.
const fakebin = path.join(root, 'bin')
write(fakebin, { gh: '#!/bin/sh\necho "To get started with GitHub CLI, please run:  gh auth login" >&2\nexit 4\n' })
fs.chmodSync(path.join(fakebin, 'gh'), 0o755)

// A Tauri app kept in frontend/ with a run.sh (QuantApp's shape).
const tauri = path.join(root, 'desk-app')
write(tauri, {
  'run.sh': '#!/bin/sh\necho "starting"\n',
  'README.md': '# Desk app\n\nA native desktop app.\n',
  'frontend/package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '6', '@tauri-apps/cli': '2' } }),
  'frontend/src-tauri/tauri.conf.json': '{}'
})
git(tauri, 'init', '-q', '-b', 'main')
git(tauri, 'add', '-A')
git(tauri, 'commit', '-q', '-m', 'Initial commit')

// A site whose "GitHub" remote is really a local bare repo (url.insteadOf), so pushes can be checked.
const bare = path.join(root, 'remote.git')
const site = path.join(root, 'shop-site')
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
write(site, {
  'index.html': '<!doctype html><title>Shop</title><body style="font:16px system-ui;padding:40px"><h1>Shop front</h1><p>A small static site.</p></body>',
  'README.md': '# Shop site\n\nA small static shop front.\n'
})
git(site, 'init', '-q', '-b', 'main')
git(site, 'add', '-A')
git(site, 'commit', '-q', '-m', 'Initial commit')
git(site, 'remote', 'add', 'origin', 'https://github.com/demo/shop-site.git')
git(site, 'config', `url.${bare}.insteadOf`, 'https://github.com/demo/shop-site.git')
git(site, 'push', '-q', '-u', 'origin', 'main')
write(site, {
  'index.html': '<!doctype html><title>Shop</title><body style="font:16px system-ui;padding:40px"><h1>Shop front</h1><p>Now with a sale banner.</p></body>',
  'sale.css': 'body { background: #fffbe6 }\n'
})

const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const app = await _electron.launch({
    executablePath: require(path.join(APP, 'node_modules', 'electron')),
    args: ['--no-sandbox', APP],
    env: { ...process.env, ...ident, HANGAR_VAULT: vault, HANGAR_USER_DATA: path.join(root, 'userdata'), NODE_OPTIONS: '', SHELL: '/bin/sh', PATH: `${fakebin}:${process.env.PATH}` }
  })
  await app.firstWindow()
  const isMain = (w) => w.url().endsWith('/index.html')
  const win = app.windows().find(isMain) || (await app.waitForEvent('window', { predicate: isMain }))
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => m.type() === 'error' && !/GUEST_VIEW_MANAGER_CALL|ERR_ABORTED|\(-3\)/.test(m.text()) && errors.push(m.text()))
  await win.waitForSelector('.app')
  const shot = (name) => win.screenshot({ path: path.join(OUT, `${name}.png`) })
  const addByPath = async (p) => {
    await win.click('.side-label button[aria-label="Add project"]')
    await win.fill('.modal input[placeholder^="Search, or paste"]', p)
    await win.click('.modal-f button.pri')
    await win.waitForSelector('.proj-head h1', { timeout: 30_000 })
  }

  await wait(800)
  await shot('01-welcome')
  check('welcome screen shows', await win.isVisible('text=Welcome to Hangar'))

  await addByPath(tauri)
  await win.waitForSelector('.proj-head h1:has-text("Desk App")')
  await wait(800)
  await shot('02-desktop-app-overview')
  check('Tauri app detected with ./run.sh', /\.\/run\.sh/.test((await win.textContent('.kv:has-text("Preview")')) || ''))

  await addByPath(site)
  await win.click('.tabs button:has-text("Repository")')
  await win.waitForSelector('.changes')
  await win.click('.changes button[aria-expanded]')
  await win.fill('.changes input[aria-label="Commit message"]', 'Add a sale banner')
  await shot('03-repo-changes')
  await win.click('.changes button.pri')
  await win.waitForFunction(() => /pushed|failed|Nothing/i.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 30_000 })
  check('commit & push', /pushed to GitHub/i.test((await win.textContent('.toast')) || ''))
  check('remote got the commit', git(bare, 'log', '-1', '--pretty=%s').trim() === 'Add a sale banner')

  await win.click('.tabs button:has-text("Preview")')
  await win.waitForSelector('webview', { timeout: 30_000 })
  await wait(2500)
  await shot('04-preview-site')
  check('site preview shows', (await win.$$('webview')).length === 1)

  await win.click('.side-label button[aria-label="Add project"]')
  await win.click('.modal .seg button:has-text("New")')
  await win.fill('.modal input[placeholder="My new project"]', 'Arena IO')
  await win.click('.modal .seg button:has-text("Browser game")')
  await win.click('.modal-f button.pri')
  await win.waitForSelector('.proj-head h1:has-text("Arena IO")', { timeout: 30_000 })
  await win.click('.tabs button:has-text("Preview")')
  await win.waitForSelector('webview', { timeout: 30_000 })
  await win.click('button[aria-label="2 players"]')
  await wait(2500)
  await shot('05-preview-game-2p')
  check('game preview shows 2 players', (await win.$$('webview')).length === 2)
  const up = await app.evaluate(async () => fetch('http://localhost:3000/game.js').then((r) => r.status, String))
  check('game dev server answers', up === 200, String(up))

  await win.click('.tabs button:has-text("Notes")')
  await wait(1500)
  const down = await app.evaluate(async () => fetch('http://localhost:3000/').then(() => 'still up', () => 'stopped'))
  check('leaving Preview stops the server', down === 'stopped', down)

  await win.fill('textarea.notes-editor', '# Arena IO\n\nA multiplayer .io game. Shares ideas with [[Shop Site]].\n\n## Next\n\n- [x] Movement\n- [ ] Rooms\n- [ ] Leaderboard\n')
  await wait(900)
  await win.click('.seg button:has-text("Read")')
  await win.click('.notes-body input[type="checkbox"] >> nth=1')
  await wait(900)
  await shot('06-notes')
  check('notes saved and task ticked', fs.readFileSync(path.join(vault, 'arena-io', 'notes.md'), 'utf8').includes('- [x] Rooms'))

  await win.click('.side button:has-text("All projects")')
  await wait(800)
  await shot('07-home')
  check('home lists 3 projects', (await win.$$('.list .list-row')).length === 3)
  check('GitHub shown as not signed in', await win.isVisible('text=GitHub CLI not signed in'))
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await win.waitForSelector('.palette')
  await win.keyboard.type('are')
  await shot('08-palette')

  check('no renderer errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await app.close()
  console.log(results.join('\n'))
  console.log(`Screenshots: ${OUT}`)
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0)
})().catch((e) => {
  console.log(results.join('\n'))
  console.error('E2E FAILED:', e)
  process.exit(1)
})
