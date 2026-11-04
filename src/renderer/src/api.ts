import type { HangarApi } from '@shared/types'

declare global {
  interface Window {
    hangar: HangarApi
  }
}

export const api: HangarApi = window.hangar

/** The readable part of an error that crossed the IPC bridge. */
export function errMsg(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, '')
}
