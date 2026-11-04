// The shapes shared by the main process, the preload bridge and the UI.

export type Status = 'idea' | 'building' | 'live' | 'paused'
export type PreviewKind = 'web' | 'desktop' | 'console' | 'none'
export type LaunchKind = 'app' | 'url' | 'cmd' | 'none'
export type DesktopView = 'interface' | 'window'

export interface AppWindow {
  id: string
  name: string
}

export interface WindowList {
  /** macOS screen-recording permission ('granted' elsewhere). */
  permission: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'
  windows: AppWindow[]
}

/** What lives in <vault>/<id>/hangar.json. Plain JSON, so it can be edited by hand or by Claude. */
export interface HangarFile {
  version: 1
  name: string
  status: Status
  description: string
  tags: string[]
  links: { label: string; url: string }[]
  /** Where the code is: "repo" (inside the project folder) or an absolute path (a linked folder). Null when there is no code yet. */
  code: string | null
  /** `view` is how a desktop app shows in the box: its web interface, or a live picture of its window. */
  preview: { command: string; kind: PreviewKind; url?: string; view?: DesktopView }
  launch: { kind: LaunchKind; target: string }
  createdAt: string
}

export interface Remote {
  owner: string
  name: string
  fullName: string
  url: string
}

export interface Project extends HangarFile {
  id: string
  /** The project folder in the vault (hangar.json, notes.md, assets/). */
  home: string
  /** Absolute path to the code, or null. */
  codePath: string | null
  codeExists: boolean
  isGit: boolean
  remote: Remote | null
  updatedAt: string
}

export interface Detection {
  label: string
  kind: PreviewKind
  command: string
  url?: string
  tags: string[]
  description?: string
}

export interface FoundFolder {
  path: string
  name: string
  isGit: boolean
  hasRemote: boolean
  detection: Detection
}

export interface GhRepo {
  fullName: string
  name: string
  description: string
  isPrivate: boolean
  updatedAt: string
  language: string
  url: string
}

export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  status?: 'M' | 'A' | 'D' | 'R' | '?'
  lastCommit?: { sha: string; message: string; when: string }
}

export interface Change {
  code: 'M' | 'A' | 'D' | 'R' | '?'
  path: string
}

export interface GitStatus {
  isGit: boolean
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  changes: Change[]
}

export interface Commit {
  sha: string
  message: string
  when: string
  author: string
}

export interface Release {
  tag: string
  name: string
  isDraft: boolean
  publishedAt: string | null
  assets: { name: string; size: number }[]
}

export interface RepoInfo {
  fullName: string
  name: string
  url: string
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL'
  isArchived: boolean
  description: string
}

export interface EnvInfo {
  platform: string
  vault: string
  gh: { installed: boolean; loggedIn: boolean; user: string | null }
  tools: { git: boolean; code: boolean; claude: boolean; scrcpy: boolean }
}

export interface Settings {
  vault: string
  accent: 'mono' | 'violet'
  theme: 'system' | 'dark' | 'light'
  editor: 'vscode' | 'cursor'
  dismissedFound: string[]
}

export type PreviewStatus = 'idle' | 'installing' | 'starting' | 'running' | 'exited'

export interface PreviewState {
  id: string
  status: PreviewStatus
  command: string
  url: string | null
  logs: string[]
  exitCode: number | null
  startedAt: string | null
}

export type PreviewEvent =
  | { id: string; type: 'log'; line: string }
  | { id: string; type: 'url'; url: string }
  | { id: string; type: 'status'; status: PreviewStatus; exitCode?: number | null }

export interface ActionResult {
  ok: boolean
  message: string
}

export type OpenTarget = 'claude' | 'editor' | 'terminal' | 'finder' | 'github'

export interface NewProjectInput {
  name: string
  template: 'blank' | 'web' | 'game' | 'python'
  createRepo: boolean
  visibility: 'private' | 'public'
}

/** Everything the UI can ask the main process to do. */
export interface HangarApi {
  env(): Promise<EnvInfo>
  settings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>

  listProjects(): Promise<Project[]>
  updateProject(id: string, patch: Partial<HangarFile>): Promise<Project>
  removeProject(id: string): Promise<void>
  createProject(input: NewProjectInput): Promise<{ project: Project; warning: string | null }>
  linkFolder(path: string, move: boolean): Promise<Project>
  cloneRepo(fullName: string, description?: string): Promise<Project>
  discover(): Promise<FoundFolder[]>
  githubRepos(): Promise<GhRepo[]>
  detect(path: string): Promise<Detection>
  pickFolder(): Promise<string | null>
  pickFiles(): Promise<string[]>

  readNotes(id: string): Promise<string>
  writeNotes(id: string, text: string): Promise<void>

  listFiles(id: string, rel: string): Promise<FileEntry[]>
  uploadFiles(id: string, rel: string, paths: string[]): Promise<ActionResult>
  deletePath(id: string, rel: string): Promise<ActionResult>
  listAssets(id: string): Promise<FileEntry[]>
  addAssets(id: string, paths: string[]): Promise<ActionResult>

  gitStatus(id: string): Promise<GitStatus>
  gitLog(id: string, limit: number): Promise<Commit[]>
  branches(id: string): Promise<string[]>
  checkout(id: string, branch: string, create: boolean): Promise<ActionResult>
  pull(id: string): Promise<ActionResult>
  commitPush(id: string, message: string): Promise<ActionResult>

  createRepo(id: string, visibility: 'private' | 'public'): Promise<ActionResult>
  repoInfo(id: string): Promise<RepoInfo | null>
  renameRepo(id: string, name: string): Promise<ActionResult>
  setVisibility(id: string, visibility: 'private' | 'public'): Promise<ActionResult>
  setArchived(id: string, archived: boolean): Promise<ActionResult>
  deleteRepo(id: string): Promise<ActionResult>
  releases(id: string): Promise<Release[]>
  createRelease(id: string, tag: string, title: string, notes: string): Promise<ActionResult>
  uploadReleaseAssets(id: string, tag: string, paths: string[]): Promise<ActionResult>
  publishRelease(id: string, tag: string): Promise<ActionResult>

  openIn(id: string, target: OpenTarget): Promise<ActionResult>
  launch(id: string): Promise<ActionResult>
  revealPath(path: string): Promise<void>
  openPath(path: string): Promise<void>
  openUrl(url: string): Promise<void>

  previewStart(id: string, view?: DesktopView): Promise<PreviewState>
  previewStop(id: string): Promise<void>
  previewRestart(id: string, view?: DesktopView): Promise<PreviewState>
  /** Interface: the app's own window is hidden. Window: it is shown (behind Hangar) and mirrored. */
  previewSetView(id: string, view: DesktopView): Promise<void>
  /** The windows the running preview has opened, ready to be mirrored. */
  previewWindows(id: string): Promise<WindowList>
  /** Move the app's window exactly over this part of Hangar's window and bring it to the front. */
  previewFocusWindow(id: string, sourceId: string, rect: { x: number; y: number; width: number; height: number }): Promise<ActionResult>
  openPrivacy(kind: 'screen' | 'accessibility'): Promise<void>
  onPreview(cb: (e: PreviewEvent) => void): () => void
  onProjectsChanged(cb: () => void): () => void
  onNavigate(cb: (target: { projectId?: string; addProject?: boolean }) => void): () => void
  onLauncherShown(cb: () => void): () => void

  /** Path of a dragged-in file (Electron no longer exposes File.path). */
  pathForFile(file: File): string
  launcherHide(): Promise<void>
  showMain(target: { projectId?: string; addProject?: boolean }): Promise<void>
}

/** IPC channel names: every HangarApi method that is a plain request/response. */
export const INVOKE_METHODS = [
  'env', 'settings', 'saveSettings',
  'listProjects', 'updateProject', 'removeProject', 'createProject', 'linkFolder', 'cloneRepo', 'discover', 'githubRepos', 'detect', 'pickFolder', 'pickFiles',
  'readNotes', 'writeNotes',
  'listFiles', 'uploadFiles', 'deletePath', 'listAssets', 'addAssets',
  'gitStatus', 'gitLog', 'branches', 'checkout', 'pull', 'commitPush',
  'createRepo', 'repoInfo', 'renameRepo', 'setVisibility', 'setArchived', 'deleteRepo', 'releases', 'createRelease', 'uploadReleaseAssets', 'publishRelease',
  'openIn', 'launch', 'revealPath', 'openPath', 'openUrl',
  'previewStart', 'previewStop', 'previewRestart', 'previewSetView', 'previewWindows', 'previewFocusWindow', 'openPrivacy',
  'launcherHide', 'showMain'
] as const

export type InvokeMethod = (typeof INVOKE_METHODS)[number]
