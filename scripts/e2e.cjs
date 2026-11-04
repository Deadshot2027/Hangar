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

// A desktop app that serves an interface and opens a real (red) window of its own.
const desk = path.join(root, 'fixture-desk')
write(desk, {
  'package.json': JSON.stringify({ description: 'A desktop app that opens a real window.', scripts: { dev: 'node start.js' }, devDependencies: { electron: '36.9.5' } }),
  'node_modules/.keep': '',
  'start.js': [
    "const http = require('http')",
    "const { spawn } = require('child_process')",
    "http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<body style=\"margin:0;background:#2266ff;color:#fff;font:32px sans-serif\"><h1>Fixture interface</h1></body>') }).listen(4567, () => console.log('  Local:   http://localhost:4567/'))",
    "spawn(process.env.HANGAR_E2E_ELECTRON, ['--no-sandbox', __dirname + '/window.js'], { stdio: 'inherit' })"
  ].join('\n'),
  'window.js': [
    "const { app, BrowserWindow } = require('electron')",
    "app.whenReady().then(() => {",
    "  const w = new BrowserWindow({ width: 520, height: 380, title: 'Fixture Desk', backgroundColor: '#ff3366' })",
    "  w.loadURL('data:text/html,<title>Fixture Desk</title><body style=\"margin:0;background:%23ff3366;color:white;font:36px sans-serif\"><h1>Real window</h1></body>')",
    "})"
  ].join('\n')
})

// A web app whose backend comes up a few seconds after its page: the loading screen waits for both.
const slow = path.join(root, 'slow-api')
write(slow, {
  'package.json': JSON.stringify({ description: 'A page with a slow backend.', scripts: { dev: 'node dev.js' }, dependencies: { express: '4' } }),
  'node_modules/.keep': '',
  'src/api.js': "export const API = 'http://127.0.0.1:4611'\nexport const ping = () => fetch(API + '/health')\n",
  'dev.js': [
    "const http = require('http')",
    "console.log('=== Building the backend (about five seconds) ===')",
    'setTimeout(() => {',
    "  http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<body style=\"margin:0;font:28px sans-serif;padding:40px\"><h1>Slow API app</h1></body>') }).listen(4610, () => console.log('  Local:   http://localhost:4610/'))",
    '}, 800)',
    'setTimeout(() => {',
    "  console.log('=== Starting the API ===')",
    "  http.createServer((q, r) => r.end('ok')).listen(4611, () => console.log('API listening'))",
    '}, 6000)',
    'setInterval(() => {}, 1000)'
  ].join('\n')
})

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
  // App windows can only be listed under a window manager; start one on a bare Linux display.
  let wm = null
  if (process.platform === 'linux') {
    try {
      execFileSync('which', ['openbox'], { stdio: 'ignore' })
      wm = require('child_process').spawn('openbox', [], { stdio: 'ignore' })
      await wait(800)
    } catch {
      /* no window manager: the window check will report it */
    }
  }
  const electronBin = require(path.join(APP, 'node_modules', 'electron'))
  // HANGAR_E2E_APP: run a packaged build (dist/…) instead of the source folder.
  const packaged = process.env.HANGAR_E2E_APP
  const app = await _electron.launch({
    executablePath: packaged || electronBin,
    args: packaged ? ['--no-sandbox'] : ['--no-sandbox', APP],
    env: { ...process.env, ...ident, HANGAR_VAULT: vault, HANGAR_USER_DATA: path.join(root, 'userdata'), NODE_OPTIONS: '', SHELL: '/bin/sh', PATH: `${fakebin}:${process.env.PATH}`, HANGAR_E2E_ELECTRON: electronBin }
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
  check('logo in the sidebar and on the welcome screen', (await win.$$('.brand svg.logo')).length === 1 && (await win.$$('.welcome svg.logo-hero')).length === 1)

  await addByPath(tauri)
  await win.waitForSelector('.proj-head h1:has-text("Desk App")')
  await wait(800)
  await shot('02-desktop-app-overview')
  check('Tauri app detected with ./run.sh', /\.\/run\.sh/.test((await win.textContent('.kv:has-text("Preview")')) || ''))
  {
    const title = await win.locator('.proj-head h1').boundingBox()
    const launchBtn = await win.locator('.proj-head button:has-text("Launch")').boundingBox()
    const inTopbar = await win.locator('.topbar button:has-text("Launch")').count()
    check('Launch sits on the right of the project title', !!title && !!launchBtn && !inTopbar && launchBtn.x > title.x + 400 && Math.abs(launchBtn.y + launchBtn.height / 2 - (title.y + title.height / 2)) < 6)
  }

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

  // The loading screen: it shows what it waits for, and goes once the page and its backend answer.
  await addByPath(slow)
  await win.click('.tabs button:has-text("Preview")')
  try {
    await win.waitForSelector('.boot .boot-step.now:has-text("Waiting for the backend")', { timeout: 20_000 })
    await wait(600)
    await shot('06-preview-loading')
    const steps = await win.$$eval('.boot-step', (els) => els.map((e) => `${e.classList.contains('ok') ? '+' : '-'}${e.textContent}`))
    check('loading screen shows its steps', steps.some((t) => t.startsWith('+Building the backend')) && steps.some((t) => t.includes('127.0.0.1:4611')), steps.join(' | '))
    check('page waits behind the loading screen', (await win.$$('webview')).length === 1 && !(await win.$('.boot.done')))
    await win.waitForSelector('.boot.done', { timeout: 20_000 })
    await wait(700)
    await shot('07-preview-ready')
    check('loading screen goes once the backend answers', true)
  } catch (e) {
    await shot('06-preview-loading')
    check('loading screen shows its steps', false, e.message.split('\n')[0])
  }
  {
    const g = await win.$eval('.proj-head .tabs > .glide', (el) => ({ o: getComputedStyle(el).opacity, w: el.getBoundingClientRect().width }))
    const on = await win.$eval('.proj-head .tabs button.on', (el) => el.getBoundingClientRect().width)
    check('tab underline glides under the open tab', Number(g.o) > 0.9 && Math.abs(g.w - on) < 2, `${g.w} vs ${on}`)
  }

  await win.click('.tabs button:has-text("Notes")')
  await wait(1500)
  const down = await app.evaluate(async () => fetch('http://localhost:3000/').then(() => 'still up', () => 'stopped'))
  check('leaving Preview stops the server', down === 'stopped', down)

  // A desktop app: its real window shows live inside the box, and so does its interface.
  await addByPath(desk)
  await win.click('.tabs button:has-text("Preview")')
  try {
    await win.waitForFunction(() => (document.querySelector('video')?.videoWidth || 0) > 0, null, { timeout: 30_000 })
    await wait(1200)
    const px = await win.evaluate(() => {
      const v = document.querySelector('video')
      const c = document.createElement('canvas')
      c.width = v.videoWidth
      c.height = v.videoHeight
      const g = c.getContext('2d')
      g.drawImage(v, 0, 0)
      return [c.width, c.height, ...Array.from(g.getImageData(Math.floor(c.width / 2), Math.floor(c.height * 0.85), 1, 1).data)]
    })
    check('desktop app window shows live in the box', px[2] > 200 && px[3] < 110 && px[4] > 60 && px[4] < 160, `${px[0]}x${px[1]} rgb(${px.slice(2, 5).join(',')})`)
  } catch (e) {
    check('desktop app window shows live in the box', false, e.message.split('\n')[0])
  }
  await shot('08-preview-desktop-window')
  await win.click('.frame-bar .seg button:has-text("Interface")')
  await win.waitForSelector('webview', { timeout: 30_000 })
  await wait(2000)
  await shot('09-preview-desktop-interface')
  check('desktop app interface shows in the box', ((await win.getAttribute('webview', 'src')) || '').includes('4567'))
  await win.click('.tabs button:has-text("Overview")')
  await wait(2500)
  const windowsLeft = await app.evaluate(({ desktopCapturer }) => desktopCapturer.getSources({ types: ['window'] }).then((s) => s.map((x) => x.name)))
  check('leaving Preview closes the desktop app', !windowsLeft.includes('Fixture Desk'), windowsLeft.join(', '))
  await win.click('.side button:has-text("Arena IO")')
  await win.click('.tabs button:has-text("Notes")')

  await win.fill('textarea.notes-editor', '# Arena IO\n\nA multiplayer .io game. Shares ideas with [[Shop Site]].\n\n## Next\n\n- [x] Movement\n- [ ] Rooms\n- [ ] Leaderboard\n')
  await wait(900)
  await win.click('.seg button:has-text("Read")')
  await win.click('.notes-body input[type="checkbox"] >> nth=1')
  await wait(900)
  await shot('10-notes')
  check('notes saved and task ticked', fs.readFileSync(path.join(vault, 'arena-io', 'notes.md'), 'utf8').includes('- [x] Rooms'))

  await win.click('.side button:has-text("All projects")')
  await wait(800)
  await shot('11-home')
  check('home lists 5 projects', (await win.$$('.list .list-row')).length === 5)
  check('no preview left marked live after leaving them', (await win.$$('.side [aria-label="Preview live"]')).length === 0)
  check('GitHub shown as not signed in', await win.isVisible('text=GitHub CLI not signed in'))
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await win.waitForSelector('.palette')
  await win.keyboard.type('are')
  await wait(500)
  await shot('12-palette')
  // The first Escape clears the search, the second closes it.
  await win.keyboard.press('Escape')
  await win.keyboard.press('Escape')
  await win.waitForSelector('.palette', { state: 'detached', timeout: 3000 })

  // Open in: the menu grows out of its button, and its highlight follows the pointer.
  await win.click('.side button:has-text("Shop Site")')
  await win.click('.topbar button:has-text("Open in")')
  await wait(700)
  await win.hover('.menu-item:has-text("Terminal")')
  await wait(500)
  await shot('13-open-in')
  {
    const body = await win.$eval('.menu .grow-body', (el) => Number(getComputedStyle(el).opacity))
    const bg = await win.$eval('.menu .grow-bg', (el) => el.getBoundingClientRect().height)
    const menu = await win.$eval('.menu', (el) => el.getBoundingClientRect().height)
    const hi = await win.$eval('.menu-items > .glide', (el) => [Number(getComputedStyle(el).opacity), el.getBoundingClientRect().top])
    const term = await win.$eval('.menu-item:has-text("Terminal")', (el) => el.getBoundingClientRect().top)
    check('Open in menu grows out of its button', body > 0.99 && Math.abs(bg - menu) < 1.5, `${bg} vs ${menu}`)
    check('menu highlight follows the pointer', hi[0] > 0.9 && Math.abs(hi[1] - term) < 1.5)
  }
  await win.keyboard.press('Escape')
  await win.waitForSelector('.menu', { state: 'detached', timeout: 3000 })
  check('menu shrinks back and goes', true)

  // Dark with the violet accent: the same glass and mark.
  await win.evaluate(() => {
    document.documentElement.classList.remove('t-light', 'a-mono')
    document.documentElement.classList.add('t-dark', 'a-violet')
  })
  await win.click('.topbar button:has-text("Open in")')
  await wait(700)
  await win.hover('.menu-item:has-text("VS Code")')
  await wait(500)
  await shot('14-dark-violet')
  await win.keyboard.press('Escape')

  check('no renderer errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await app.close()
  wm?.kill()
  console.log(results.join('\n'))
  console.log(`Screenshots: ${OUT}`)
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0)
})().catch((e) => {
  console.log(results.join('\n'))
  console.error('E2E FAILED:', e)
  process.exit(1)
})
