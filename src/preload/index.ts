import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { INVOKE_METHODS } from '@shared/types'

// The only door between the UI and the Mac: a fixed list of request/response
// calls plus three event streams. The UI never gets Node or Electron itself.

const api: Record<string, unknown> = {}

for (const method of INVOKE_METHODS) {
  api[method] = (...args: unknown[]) => ipcRenderer.invoke(`hangar:${method}`, ...args)
}

function subscribe(channel: string) {
  return (cb: (payload: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

api.onPreview = subscribe('preview:event')
api.onProjectsChanged = subscribe('projects:changed')
api.onNavigate = subscribe('navigate')
api.onLauncherShown = subscribe('launcher:shown')
api.pathForFile = (file: File) => webUtils.getPathForFile(file)

contextBridge.exposeInMainWorld('hangar', api)
