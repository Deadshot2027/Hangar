#!/usr/bin/env node
// Makes sure Electron's app binary is in node_modules before Hangar starts.
//
// The electron package normally downloads it in its own install step, but that
// step is skipped by npm's ignore-scripts and by pnpm or bun, and on newer Node
// versions its downloader and unzipper can quit silently half way. So this does
// the job itself with the tools every Mac has: curl to download the exact zip,
// a SHA-256 check against Electron's published checksums, and ditto to unpack it
// (keeping the app bundle's symlinks). Each step says what went wrong if it fails.
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync, execSync } = require('child_process')

function die(msg) {
  console.error(`\n${msg}\n`)
  process.exit(1)
}

let dir
try {
  dir = path.dirname(require.resolve('electron/package.json'))
} catch {
  die('Electron is not in node_modules. Run `npm install` first.')
}
const { version } = require(path.join(dir, 'package.json'))
const dist = path.join(dir, 'dist')

function platformPath() {
  if (process.platform === 'darwin') return 'Electron.app/Contents/MacOS/Electron'
  if (process.platform === 'win32') return 'electron.exe'
  return 'electron'
}

function installed() {
  try {
    const have = fs.readFileSync(path.join(dist, 'version'), 'utf8').trim().replace(/^v/, '')
    const exe = fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim()
    return have === version && !!exe && fs.existsSync(path.join(dist, exe))
  } catch {
    return false
  }
}

function targetArch() {
  let arch = process.env.npm_config_arch || process.arch
  // Node running under Rosetta on an Apple Silicon Mac still wants the arm64 build.
  if (process.platform === 'darwin' && arch === 'x64') {
    try {
      if (execSync('sysctl -in sysctl.proc_translated', { encoding: 'utf8' }).trim() === '1') arch = 'arm64'
    } catch {
      /* not under Rosetta */
    }
  }
  return arch
}

if (installed()) process.exit(0)

const arch = targetArch()
const file = `electron-v${version}-${process.platform}-${arch}.zip`
const mirror = (process.env.ELECTRON_MIRROR || 'https://github.com/electron/electron/releases/download/').replace(/\/?$/, '/')
const url = `${mirror}v${version}/${file}`
const cacheDir = path.join(dir, '..', '.cache', 'hangar-electron')
const zip = path.join(cacheDir, file)
let expected = null
try {
  expected = require(path.join(dir, 'checksums.json'))[file] || null
} catch {
  /* no checksum list: skip the check */
}
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

console.log(`Electron ${version} isn't downloaded yet. Getting it now (about 100 MB, only once).`)
console.log(`  Node ${process.version}, ${process.platform}-${arch}`)

// 1. Download (reusing a good copy from an earlier attempt).
fs.mkdirSync(cacheDir, { recursive: true })
if (!(fs.existsSync(zip) && (!expected || sha256(zip) === expected))) {
  const part = `${zip}.part`
  console.log(`  Downloading ${url}`)
  const r = spawnSync('curl', ['-fL', '--retry', '3', '--connect-timeout', '30', '--progress-bar', '-o', part, url], { stdio: 'inherit' })
  if (r.error) die(`Could not run curl (${r.error.message}).\nDownload this file in your browser:\n  ${url}\nsave it as:\n  ${zip}\nthen run \`npm run dev\` again.`)
  if (r.status !== 0) die(`Downloading Electron failed (curl exit code ${r.status}).\n  ${url}\nIf you use a VPN, proxy or firewall app, try with it off. You can also download the file in your browser and save it as:\n  ${zip}`)
  fs.renameSync(part, zip)
}

// 2. Check it is the real file.
if (expected) {
  const got = sha256(zip)
  if (got !== expected) {
    fs.rmSync(zip, { force: true })
    die(`The downloaded file did not match Electron's checksum, so it was deleted.\n  expected ${expected}\n  got      ${got}\nRun \`npm run dev\` again.`)
  }
  console.log('  Checksum OK')
}

// 3. Unpack into node_modules/electron/dist.
fs.rmSync(dist, { recursive: true, force: true })
fs.mkdirSync(dist, { recursive: true })
const unpack =
  process.platform === 'darwin'
    ? spawnSync('ditto', ['-x', '-k', zip, dist], { stdio: 'inherit' })
    : process.platform === 'win32'
      ? spawnSync('tar', ['-xf', zip, '-C', dist], { stdio: 'inherit' })
      : spawnSync('unzip', ['-q', '-o', zip, '-d', dist], { stdio: 'inherit' })
if (unpack.error || unpack.status !== 0) die(`Unpacking Electron failed (${unpack.error ? unpack.error.message : `exit code ${unpack.status}`}).\nThe download is kept at ${zip}.`)

// 4. Finish the way Electron's own installer does.
const types = path.join(dist, 'electron.d.ts')
if (fs.existsSync(types)) fs.renameSync(types, path.join(dir, 'electron.d.ts'))
fs.writeFileSync(path.join(dir, 'path.txt'), platformPath())

if (!installed()) die(`Electron was unpacked, but ${path.join(dist, platformPath())} is missing. Please send this whole output.`)
console.log('  Electron is ready.\n')
