import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { shell } from 'electron'
import type { ActionResult, OpenTarget, Project, Settings } from '@shared/types'
import { run, which } from './exec'
import { expandHome } from './paths'

const isMac = process.platform === 'darwin'

/** Quote for a POSIX shell, then for an AppleScript string. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
function asString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Open a new Terminal window in `dir` and type `command` into it. */
async function terminalRun(dir: string, command: string): Promise<ActionResult> {
  if (!isMac) return { ok: false, message: 'Running in Terminal is macOS-only for now.' }
  const line = `cd ${shQuote(dir)}${command ? ` && ${command}` : ''}`
  const script = `tell application "Terminal"\nactivate\ndo script ${asString(line)}\nend tell`
  const r = await run('osascript', ['-e', script], { timeout: 15_000 })
  if (r.code !== 0) return { ok: false, message: 'macOS would not let Hangar control Terminal. Allow it in System Settings → Privacy & Security → Automation.' }
  return { ok: true, message: command ? `Running ${command} in Terminal.` : 'Opened Terminal.' }
}

async function openApp(appName: string, path: string): Promise<boolean> {
  if (!isMac) return false
  const r = await run('open', ['-a', appName, path], { timeout: 15_000 })
  return r.code === 0
}

export async function openIn(project: Project, target: OpenTarget, settings: Settings): Promise<ActionResult> {
  const dir = project.codePath && project.codeExists ? project.codePath : project.home
  switch (target) {
    case 'claude': {
      if (!isMac && !(await which('claude'))) return { ok: false, message: 'Claude Code is not installed. See claude.com/claude-code.' }
      const res = await terminalRun(dir, 'claude')
      return res.ok ? { ok: true, message: `Opening ${project.name} in Claude Code.` } : res
    }
    case 'editor': {
      const app = settings.editor === 'cursor' ? 'Cursor' : 'Visual Studio Code'
      const cli = settings.editor === 'cursor' ? 'cursor' : 'code'
      if (await openApp(app, dir)) return { ok: true, message: `Opening ${project.name} in ${settings.editor === 'cursor' ? 'Cursor' : 'VS Code'}.` }
      if (await which(cli)) {
        await run(cli, [dir])
        return { ok: true, message: `Opening ${project.name} in ${cli}.` }
      }
      return { ok: false, message: `${app} is not installed.` }
    }
    case 'terminal': {
      if (isMac && (await openApp('Terminal', dir))) return { ok: true, message: 'Opened Terminal.' }
      return terminalRun(dir, '')
    }
    case 'finder': {
      const err = await shell.openPath(dir)
      return err ? { ok: false, message: err } : { ok: true, message: `Showing ${basename(dir)} in Finder.` }
    }
    case 'github': {
      if (!project.remote) return { ok: false, message: `${project.name} is not on GitHub yet.` }
      await shell.openExternal(project.remote.url)
      return { ok: true, message: `Opening ${project.remote.fullName} on GitHub.` }
    }
  }
}

/** Launch opens the real thing: the installed app, the live site, or a command in Terminal. */
export async function launch(project: Project): Promise<ActionResult> {
  const { kind } = project.launch
  const target = project.launch.target.trim()
  if (kind === 'none' || !target) return { ok: false, message: 'Choose what Launch opens in this project’s Settings.' }
  if (kind === 'url') {
    const url = /^https?:\/\//i.test(target) ? target : `https://${target}`
    await shell.openExternal(url)
    return { ok: true, message: `Opening ${url}` }
  }
  if (kind === 'app') {
    const path = expandHome(target)
    if (!existsSync(path)) return { ok: false, message: `${basename(path)} isn't installed. Install a release build, or change what Launch opens in Settings.` }
    if (isMac && (await run('open', [path], { timeout: 15_000 })).code === 0) return { ok: true, message: `Opening ${basename(path)}` }
    const err = await shell.openPath(path)
    return err ? { ok: false, message: err } : { ok: true, message: `Opening ${basename(path)}` }
  }
  const dir = project.codePath && project.codeExists ? project.codePath : project.home
  return terminalRun(dir, target)
}
