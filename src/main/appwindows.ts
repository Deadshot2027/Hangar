import { run } from './exec'

// Keeping a desktop app's window inside the Preview box. macOS does not let one
// app embed another app's window, so Hangar either hides the app's own window
// and shows its web interface (Tauri, Electron), or shows a live picture of the
// real window and, when you click it, moves the window exactly over the box.
// These helpers do the macOS side through System Events and CoreGraphics.

const isMac = process.platform === 'darwin'

/** `root` and every process it started, however deep (npm → node → cargo → the app). */
export async function processTree(root: number): Promise<number[]> {
  const r = await run('ps', ['-A', '-o', 'pid=,ppid='], { timeout: 5000 })
  if (r.code !== 0) return [root]
  const kids = new Map<number, number[]>()
  for (const line of r.stdout.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!pid) continue
    if (!kids.has(ppid)) kids.set(ppid, [])
    kids.get(ppid)!.push(pid)
  }
  const out: number[] = []
  const stack = [root]
  while (stack.length) {
    const p = stack.pop()!
    out.push(p)
    for (const c of kids.get(p) || []) stack.push(c)
  }
  return out
}

function osascript(script: string, lang?: 'JavaScript') {
  return run('osascript', lang ? ['-l', lang, '-e', script] : ['-e', script], { timeout: 10_000 })
}

export const canManageWindows = isMac

/** Hide (like ⌘H) or show the apps these processes belong to. Processes without windows are skipped. */
export async function setHidden(pids: number[], hidden: boolean): Promise<boolean> {
  if (!isMac || !pids.length) return false
  const body = pids.map((pid) => `try\nset visible of (first process whose unix id is ${pid}) to ${hidden ? 'false' : 'true'}\nend try`).join('\n')
  const r = await osascript(`tell application "System Events"\n${body}\nend tell`)
  return r.code === 0
}

/** Which process owns each on-screen window: CGWindowID → pid. Null when it cannot be read. */
export async function windowOwners(): Promise<Map<number, number> | null> {
  if (!isMac) return null
  const js =
    "ObjC.import('CoreGraphics');" +
    'var l = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, $.kCGNullWindowID))) || [];' +
    'JSON.stringify(l.map(function (w) { return [w.kCGWindowNumber, w.kCGWindowOwnerPID] }))'
  const r = await osascript(js, 'JavaScript')
  if (r.code !== 0) return null
  try {
    return new Map(JSON.parse(r.stdout.trim()) as [number, number][])
  } catch {
    return null
  }
}

/** "window:1234:0" → 1234 */
export function windowNumber(sourceId: string): number {
  return Number(sourceId.split(':')[1]) || 0
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Put the app's front window exactly over `rect` (screen points) and bring it to
 * the front, so using it looks like using it inside the box. Needs Accessibility.
 */
export async function dockWindow(pid: number, rect: Rect): Promise<{ ok: boolean; message: string; needs?: 'accessibility' | 'automation' }> {
  if (!isMac) return { ok: false, message: 'Using an app inside the preview works on macOS. Here it stays a live picture.' }
  const [x, y, w, h] = [rect.x, rect.y, rect.width, rect.height].map((n) => Math.round(n))
  const script = `tell application "System Events"
set p to first process whose unix id is ${pid}
set visible of p to true
set frontmost of p to true
set position of window 1 of p to {${x}, ${y}}
set size of window 1 of p to {${w}, ${h}}
end tell`
  const r = await osascript(script)
  if (r.code === 0) return { ok: true, message: '' }
  if (/assistive|accessibility|-25211|-1719/i.test(r.stderr)) {
    return { ok: false, needs: 'accessibility', message: 'To use the app inside the preview, allow Hangar in System Settings → Privacy & Security → Accessibility.' }
  }
  if (/not authori[sz]ed|-1743/i.test(r.stderr)) {
    return { ok: false, needs: 'automation', message: 'Allow Hangar to control System Events in System Settings → Privacy & Security → Automation.' }
  }
  return { ok: false, message: 'Could not move the app’s window into the preview.' }
}
