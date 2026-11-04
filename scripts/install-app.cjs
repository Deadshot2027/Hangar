#!/usr/bin/env node
// npm run app: build Hangar for this Mac and put it in Applications, replacing
// the copy that is there (quitting it first), then open it.
const { spawnSync, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (process.platform !== 'darwin') {
  console.error('npm run app builds the Mac app, so it has to run on a Mac.')
  process.exit(1)
}

const root = path.resolve(__dirname, '..')
const bin = (name) => path.join(root, 'node_modules', '.bin', name)
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const step = (msg) => console.log(`\n\x1b[1m${msg}\x1b[0m`)
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } })
  if (r.status !== 0) {
    console.error(`\n${path.basename(cmd)} failed (exit ${r.status}). Nothing in Applications was changed.`)
    process.exit(r.status || 1)
  }
}
const running = () => spawnSync('pgrep', ['-f', '/Hangar.app/Contents/MacOS/Hangar'], { encoding: 'utf8' }).stdout.trim() !== ''
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

step('1/4  Electron')
run(process.execPath, [path.join(root, 'scripts', 'ensure-electron.cjs')])

step('2/4  Building Hangar')
run(bin('electron-vite'), ['build'])

step(`3/4  Packaging Hangar.app (${arch})`)
const dist = path.join(root, 'dist')
run(bin('electron-builder'), ['--mac', 'dir', `--${arch}`, '--publish', 'never'])
const built = ['mac-arm64', 'mac', 'mac-universal'].map((d) => path.join(dist, d, 'Hangar.app')).filter((p) => fs.existsSync(p)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
if (!built) {
  console.error('electron-builder finished but no Hangar.app turned up in dist/. Nothing in Applications was changed.')
  process.exit(1)
}

step('4/4  Installing')
let dir = '/Applications'
try {
  fs.accessSync(dir, fs.constants.W_OK)
} catch {
  dir = path.join(os.homedir(), 'Applications')
  fs.mkdirSync(dir, { recursive: true })
  console.log(`/Applications is not writable for this user, so Hangar goes in ${dir}.`)
}
const target = path.join(dir, 'Hangar.app')
if (running()) {
  console.log('Quitting the Hangar that is open…')
  spawnSync('osascript', ['-e', 'tell application id "app.hangar.desktop" to quit'])
  for (let i = 0; i < 40 && running(); i++) sleep(250)
  if (running()) {
    console.error('Hangar did not quit. Quit it yourself and run npm run app again.')
    process.exit(1)
  }
}
// Copy next to the old one first, then swap, so a failed copy never leaves you without Hangar.
const fresh = path.join(dir, '.Hangar.app.new')
fs.rmSync(fresh, { recursive: true, force: true })
execFileSync('ditto', [built, fresh])
fs.rmSync(target, { recursive: true, force: true })
fs.renameSync(fresh, target)
console.log(`Installed ${target}`)
// The installed app and `npm run dev` share their settings, so only one of them can run at a time.
if (spawnSync('pgrep', ['-f', 'electron-vite(\\.js)? dev'], { encoding: 'utf8' }).stdout.trim()) {
  console.log('\nHangar is also running from `npm run dev`. Stop that one (Ctrl+C in its Terminal) and open Hangar from Applications.')
  process.exit(0)
}
spawnSync('open', [target])
console.log('\nHangar is open. It stays in your Dock while it runs; ⌥Space opens the launcher from anywhere.')
