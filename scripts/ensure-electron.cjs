#!/usr/bin/env node
// Electron's app binary is downloaded by the electron package's own install step.
// Some setups skip that step (npm's ignore-scripts, pnpm or bun blocking install
// scripts, an interrupted download), and then electron-vite fails with
// "Electron uninstall". This checks for the binary and downloads it if missing.
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

let dir
try {
  dir = path.dirname(require.resolve('electron/package.json'))
} catch {
  console.error('Electron is not in node_modules. Run `npm install` first.')
  process.exit(1)
}

function installed() {
  try {
    const { version } = require(path.join(dir, 'package.json'))
    const have = fs.readFileSync(path.join(dir, 'dist', 'version'), 'utf8').trim().replace(/^v/, '')
    const exe = fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim()
    return have === version && !!exe && fs.existsSync(path.join(dir, 'dist', exe))
  } catch {
    return false
  }
}

if (!installed()) {
  console.log('Downloading Electron (only needed once)…')
  const env = { ...process.env }
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD
  const r = spawnSync(process.execPath, [path.join(dir, 'install.js')], { cwd: dir, env, stdio: 'inherit' })
  if (r.status !== 0 || !installed()) {
    console.error('\nElectron could not be downloaded. Check your internet connection, then run:\n  node node_modules/electron/install.js\n')
    process.exit(1)
  }
  console.log('Electron is ready.')
}
