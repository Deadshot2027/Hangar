import { execFile } from 'node:child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export interface RunOptions {
  cwd?: string
  timeout?: number
  env?: NodeJS.ProcessEnv
}

/** Run a program without a shell. Never throws: the exit code and output come back. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeout ?? 120_000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, ...opts.env }
      },
      (err, stdout, stderr) => {
        if (!err) return resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) })
        const e = err as NodeJS.ErrnoException & { code?: number | string }
        const code = typeof e.code === 'number' ? e.code : 1
        const extra = typeof e.code === 'number' ? '' : e.message
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || extra })
      }
    )
  })
}

/** A tool's error output as one short sentence: the meaningful lines, cut at a sentence end. */
export function cleanError(text: string): string {
  const joined = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(hint|warning):/i.test(l))
    .slice(-3)
    .join(' ')
    .replace(/\s+/g, ' ')
  if (joined.length <= 200) return joined
  const cut = joined.slice(0, 200)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '))
  return (end > 60 ? cut.slice(0, end + 1) : cut.trimEnd() + '…').trim()
}

/** Run and return stdout, or throw an Error carrying the tool's own message. */
export async function runOk(cmd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const r = await run(cmd, args, opts)
  if (r.code !== 0) throw new Error(cleanError(r.stderr || r.stdout) || `${cmd} ${args[0] ?? ''} failed`)
  return r.stdout
}

export async function which(bin: string): Promise<boolean> {
  const r = await run(process.platform === 'win32' ? 'where' : 'which', [bin], { timeout: 5000 })
  return r.code === 0 && r.stdout.trim().length > 0
}

/**
 * Apps opened from the Dock or Finder get a bare PATH, so Homebrew's git, gh,
 * node and npm are not found. Ask the user's login shell for its PATH once.
 */
export async function loadLoginShellPath(): Promise<void> {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  const r = await run(shell, ['-ilc', 'printf "__HANGAR_PATH__%s__HANGAR_PATH__" "$PATH"'], { timeout: 8000 })
  const m = r.stdout.match(/__HANGAR_PATH__(.*)__HANGAR_PATH__/)
  if (m && m[1]) process.env.PATH = m[1]
}
