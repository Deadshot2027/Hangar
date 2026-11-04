import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, protocol, screen, shell } from 'electron'
import type { HangarApi, InvokeMethod, Settings } from '@shared/types'
import { discover, defaultRoots } from './discover'
import { detect } from './detect'
import { loadLoginShellPath, which } from './exec'
import * as git from './git'
import * as github from './github'
import { launch, openIn } from './open'
import { PreviewManager } from './preview'
import { loadSettings, saveSettings } from './settings'
import * as vault from './vault'

const isMac = process.platform === 'darwin'
if (process.env.HANGAR_USER_DATA) app.setPath('userData', process.env.HANGAR_USER_DATA)
app.setName('Hangar')
// asset://local/<absolute path> serves files from the projects folder (asset thumbnails), and nothing else.
protocol.registerSchemesAsPrivileged([{ scheme: 'asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

let mainWin: BrowserWindow | null = null
let launcherWin: BrowserWindow | null = null
let watcher: FSWatcher | null = null

const settings = (): Settings => loadSettings(app.getPath('userData'))
const vaultDir = () => settings().vault
const project = (id: string) => vault.getProject(vaultDir(), id)

const sendAll = (channel: string, payload?: unknown) => {
  for (const w of [mainWin, launcherWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
}
const preview = new PreviewManager((e) => sendAll('preview:event', e))

async function remoteOf(id: string) {
  const p = await project(id)
  if (!p.remote) throw new Error(`${p.name} is not on GitHub yet.`)
  return { p, fullName: p.remote.fullName }
}

const done = (message: string) => ({ ok: true, message })

type Handlers = { [K in InvokeMethod]: (...args: Parameters<HangarApi[K]>) => ReturnType<HangarApi[K]> }

const handlers: Handlers = {
  async env() {
    const [gh, hasGit, hasCode, hasClaude, hasScrcpy] = await Promise.all([github.ghStatus(), which('git'), which('code'), which('claude'), which('scrcpy')])
    const codeApp = isMac && (existsSync('/Applications/Visual Studio Code.app') || existsSync('/Applications/Cursor.app'))
    return { platform: process.platform, vault: vaultDir(), gh, tools: { git: hasGit, code: hasCode || codeApp, claude: hasClaude, scrcpy: hasScrcpy } }
  },
  async settings() {
    return settings()
  },
  async saveSettings(patch) {
    const next = saveSettings(app.getPath('userData'), patch)
    if (patch.vault) watchVault()
    return next
  },

  listProjects: async () => vault.listProjects(vaultDir()),
  updateProject: async (id, patch) => vault.updateProject(vaultDir(), id, patch),
  removeProject: async (id) => {
    preview.stop(id)
    await vault.removeProject(vaultDir(), id, (p) => shell.trashItem(p))
  },
  createProject: async (input) => vault.createProject(vaultDir(), input),
  linkFolder: async (path, move) => vault.linkFolder(vaultDir(), path, move),
  cloneRepo: async (fullName, description) => vault.cloneRepo(vaultDir(), fullName, description),
  async discover() {
    const projects = await vault.listProjects(vaultDir())
    const s = settings()
    const exclude = [s.vault, ...projects.map((p) => p.codePath).filter((p): p is string => !!p), ...s.dismissedFound]
    return discover(defaultRoots(), exclude)
  },
  githubRepos: async () => github.listRepos(),
  detect: async (path) => detect(path),
  async pickFolder() {
    const r = await dialog.showOpenDialog(mainWin!, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  },
  async pickFiles() {
    const r = await dialog.showOpenDialog(mainWin!, { properties: ['openFile', 'multiSelections'] })
    return r.canceled ? [] : r.filePaths
  },

  readNotes: async (id) => vault.readNotes(vaultDir(), id),
  writeNotes: async (id, text) => vault.writeNotes(vaultDir(), id, text),

  listFiles: async (id, rel) => vault.listFiles(await project(id), rel),
  uploadFiles: async (id, rel, paths) => vault.uploadFiles(await project(id), rel, paths),
  deletePath: async (id, rel) => vault.deletePath(await project(id), rel),
  listAssets: async (id) => vault.listAssets(vaultDir(), id),
  addAssets: async (id, paths) => vault.addAssets(vaultDir(), id, paths),

  gitStatus: async (id) => git.status((await project(id)).codePath),
  gitLog: async (id, limit) => git.log((await project(id)).codePath, limit),
  async branches(id) {
    const p = await project(id)
    return p.isGit ? git.branches(p.codePath!) : []
  },
  async checkout(id, branch, create) {
    const p = await project(id)
    await git.checkout(p.codePath!, branch, create)
    return done(create ? `Created ${branch} and switched to it.` : `Switched to ${branch}.`)
  },
  async pull(id) {
    const p = await project(id)
    return done(await git.pull(p.codePath!))
  },
  async commitPush(id, message) {
    const p = await project(id)
    if (!p.isGit) throw new Error('This project is not a git repo.')
    const st = await git.status(p.codePath)
    if (!st.changes.length) return done('Nothing to commit.')
    const n = st.changes.length
    await git.commitAll(p.codePath!, message.trim() || `Update ${n} file${n === 1 ? '' : 's'}`)
    try {
      const pushed = await git.push(p.codePath!)
      return done(pushed.startsWith('Pushed') ? `Committed ${n} file${n === 1 ? '' : 's'} and pushed to GitHub.` : pushed)
    } catch (e) {
      return { ok: false, message: `Committed, but the push failed: ${(e as Error).message}` }
    }
  },

  async createRepo(id, visibility) {
    await vault.createRepo(await project(id), visibility)
    return done('Created the GitHub repo and pushed your code.')
  },
  async repoInfo(id) {
    const p = await project(id)
    return p.remote ? github.view(p.remote.fullName) : null
  },
  async renameRepo(id, name) {
    const { p, fullName } = await remoteOf(id)
    const clean = name.trim().replace(/\s+/g, '-')
    await github.rename(fullName, clean)
    const old = await git.remoteUrl(p.codePath!)
    if (old) await git.setRemote(p.codePath!, old.replace(/\/[^/]+?(\.git)?$/, `/${clean}$1`))
    return done(`Renamed to ${p.remote!.owner}/${clean}.`)
  },
  async setVisibility(id, visibility) {
    const { fullName } = await remoteOf(id)
    await github.setVisibility(fullName, visibility)
    return done(`${fullName} is now ${visibility}.`)
  },
  async setArchived(id, archived) {
    const { fullName } = await remoteOf(id)
    await github.setArchived(fullName, archived)
    return done(archived ? `Archived ${fullName}. It is read-only now.` : `Unarchived ${fullName}.`)
  },
  async deleteRepo(id) {
    const { p, fullName } = await remoteOf(id)
    await github.deleteRepo(fullName)
    await git.removeRemote(p.codePath!)
    return done(`Deleted ${fullName} on GitHub. Your local folder is untouched.`)
  },
  releases: async (id) => github.releases((await remoteOf(id)).fullName),
  async createRelease(id, tag, title, notes) {
    await github.createRelease((await remoteOf(id)).fullName, tag, title, notes)
    return done(`Drafted ${tag}.`)
  },
  async uploadReleaseAssets(id, tag, paths) {
    await github.uploadAssets((await remoteOf(id)).fullName, tag, paths)
    return done(paths.length === 1 ? `Uploaded ${paths[0].split(sep).pop()} to ${tag}.` : `Uploaded ${paths.length} files to ${tag}.`)
  },
  async publishRelease(id, tag) {
    await github.publishRelease((await remoteOf(id)).fullName, tag)
    return done(`Published ${tag}.`)
  },

  openIn: async (id, target) => openIn(await project(id), target, settings()),
  launch: async (id) => launch(await project(id)),
  async revealPath(path) {
    shell.showItemInFolder(path)
  },
  async openPath(path) {
    await shell.openPath(path)
  },
  async openUrl(url) {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  },

  previewStart: async (id) => preview.start(await project(id)),
  async previewStop(id) {
    preview.stop(id)
  },
  async previewRestart(id) {
    preview.stop(id)
    await new Promise((r) => setTimeout(r, 400))
    return preview.start(await project(id))
  },

  async launcherHide() {
    launcherWin?.hide()
  },
  async showMain(target) {
    launcherWin?.hide()
    if (!mainWin || mainWin.isDestroyed()) createMain()
    mainWin!.show()
    mainWin!.focus()
    mainWin!.webContents.send('navigate', target)
  }
}

function registerIpc() {
  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(`hangar:${name}`, (_e, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args))
  }
}

function load(win: BrowserWindow, page: 'index' | 'launcher') {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) win.loadURL(page === 'index' ? dev : `${dev}/launcher.html`)
  else win.loadFile(join(__dirname, `../renderer/${page}.html`))
}

const webPreferences = () => ({
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webviewTag: true
})

function createMain() {
  mainWin = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: 'Hangar',
    backgroundColor: '#0b0c10',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: webPreferences()
  })
  mainWin.once('ready-to-show', () => mainWin?.show())
  mainWin.on('closed', () => {
    mainWin = null
  })
  load(mainWin, 'index')
}

function createLauncher() {
  launcherWin = new BrowserWindow({
    width: 720,
    height: 460,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: '#13151b',
    roundedCorners: true,
    webPreferences: { ...webPreferences(), webviewTag: false }
  })
  launcherWin.on('blur', () => launcherWin?.hide())
  load(launcherWin, 'launcher')
}

function toggleLauncher() {
  if (!launcherWin || launcherWin.isDestroyed()) createLauncher()
  const w = launcherWin!
  if (w.isVisible()) return w.hide()
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  const [ww] = w.getSize()
  w.setPosition(Math.round(x + (width - ww) / 2), Math.round(y + height * 0.22))
  w.show()
  w.focus()
  w.webContents.send('launcher:shown')
}

/** Tell the windows when projects are added, removed or edited (by Hangar, Finder or Claude). */
function watchVault() {
  watcher?.close()
  const dir = vaultDir()
  let timer: NodeJS.Timeout | null = null
  try {
    vault.ensureVault(dir).catch(() => undefined)
    watcher = watch(dir, { recursive: true }, (_evt, filename) => {
      if (!filename) return
      const parts = String(filename).split(sep)
      if (parts.length > 2 || (parts.length === 2 && parts[1] !== vault.HANGAR_FILE)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => sendAll('projects:changed'), 300)
    })
  } catch {
    watcher = null
  }
}

function harden() {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (event, prefs, params) => {
      delete (prefs as { preload?: string }).preload
      prefs.nodeIntegration = false
      prefs.contextIsolation = true
      if (!/^https?:\/\//i.test(params.src)) event.preventDefault()
    })
    if (contents.getType() === 'window') {
      contents.on('will-navigate', (event, url) => {
        const current = contents.getURL()
        if (new URL(url).origin !== new URL(current).origin) event.preventDefault()
      })
    }
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.show()
      mainWin.focus()
    }
  })

  harden()
  app.whenReady().then(async () => {
    await loadLoginShellPath()
    protocol.handle('asset', (req) => {
      const abs = resolve(decodeURIComponent(new URL(req.url).pathname))
      if (!abs.startsWith(resolve(vaultDir()) + sep)) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(abs).toString())
    })
    registerIpc()
    createMain()
    // The launcher window is made once the main window is up, so start-up stays quick.
    mainWin!.once('ready-to-show', () => createLauncher())
    watchVault()
    globalShortcut.register('Alt+Space', toggleLauncher)
    app.on('activate', () => {
      if (!mainWin) createMain()
      else mainWin.show()
    })
  })

  app.on('before-quit', () => preview.stopAll())
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
}
