import { api, errMsg } from '../api'
import { Modal, Seg, useToast } from '../components/ui'
import { useApp } from '../state'
import { tildify } from '../util'

export function AppSettings({ onClose }: { onClose: () => void }) {
  const { settings, saveSettings, env, home } = useApp()
  const toast = useToast()
  const save = async (patch: Parameters<typeof saveSettings>[0]) => {
    try {
      await saveSettings(patch)
    } catch (e) {
      toast(errMsg(e), false)
    }
  }
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="modal-b" style={{ padding: 0 }}>
        <div className="settings-rows">
          <div className="settings-row">
            <div className="label"><b>Projects folder</b><span>Where Hangar keeps each project’s notes, assets and cloned code.</span></div>
            <div className="control">
              <span className="mono" style={{ fontSize: 12 }}>{tildify(settings.vault, home)}</span>
              <div className="row">
                <button type="button" className="btn" onClick={() => api.openPath(settings.vault)}>Show in Finder</button>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const path = await api.pickFolder()
                    if (path) await save({ vault: path })
                  }}
                >
                  Change…
                </button>
              </div>
            </div>
          </div>
          <div className="settings-row" style={{ alignItems: 'center' }}>
            <div className="label"><b>Appearance</b></div>
            <div className="control">
              <Seg label="Appearance" value={settings.theme} onChange={(theme) => save({ theme })} options={[{ value: 'system', label: 'Same as Mac' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
            </div>
          </div>
          <div className="settings-row" style={{ alignItems: 'center' }}>
            <div className="label"><b>Accent</b><span>Black and white, or the violet from QuantApp’s Graphite colours.</span></div>
            <div className="control">
              <Seg label="Accent" value={settings.accent} onChange={(accent) => save({ accent })} options={[{ value: 'mono', label: 'Mono' }, { value: 'violet', label: 'Violet' }]} />
            </div>
          </div>
          <div className="settings-row" style={{ alignItems: 'center' }}>
            <div className="label"><b>Editor</b><span>Used by Open in.</span></div>
            <div className="control">
              <Seg label="Editor" value={settings.editor} onChange={(editor) => save({ editor })} options={[{ value: 'vscode', label: 'VS Code' }, { value: 'cursor', label: 'Cursor' }]} />
            </div>
          </div>
          <div className="settings-row">
            <div className="label"><b>GitHub</b><span>Through the GitHub CLI, so Hangar never stores a token.</span></div>
            <div className="control" style={{ fontSize: 12.5 }}>
              {!env ? (
                <span className="muted">Checking…</span>
              ) : env.gh.loggedIn ? (
                <span>Signed in as <b>{env.gh.user}</b></span>
              ) : env.gh.installed ? (
                <span className="dim">Not signed in. Run <code className="mono">gh auth login</code> in Terminal.</span>
              ) : (
                <span className="dim">Not installed. Run <code className="mono">brew install gh</code>, then <code className="mono">gh auth login</code>.</span>
              )}
            </div>
          </div>
          <div className="settings-row" style={{ alignItems: 'center' }}>
            <div className="label"><b>Launcher</b><span>Search and open any project from anywhere on your Mac.</span></div>
            <div className="control">
              <span className="row" style={{ gap: 4 }}><span className="kbd">⌥</span><span className="kbd">Space</span></span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
