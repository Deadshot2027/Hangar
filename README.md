# Hangar

A home for every coding project on your Mac. Find any project, open it in any tool, keep its notes and files, preview it live, launch the real thing, and manage its GitHub repo — without going through Finder or GitHub.com.

Obsidian for coding projects, with GitHub Desktop's syncing, a Raycast-style launcher and a Linear-style window (QuantApp's Workstation look).

## Run it

You need macOS, [Node.js](https://nodejs.org) 20 or newer, and git. For the GitHub features, the [GitHub CLI](https://cli.github.com):

```bash
brew install gh && gh auth login
```

Then:

```bash
npm install
npm run dev
```

`npm run dist` builds `Hangar.dmg` in `dist/`.

If Electron's download was skipped during install (for example with `ignore-scripts`, pnpm or bun), `npm run dev` fetches it on the first run. To fetch it by hand: `node node_modules/electron/install.js`.

## How it stores things

Everything is plain files. Nothing is locked inside the app.

```
~/Hangar/                     (change it in Settings)
  quantapp/
    hangar.json               name, status, links, preview and launch settings
    notes.md                  the project's notes
    assets/                   big files that don't belong in git
    repo/                     the code, when Hangar cloned or created it
```

A folder you add from elsewhere on the Mac stays where it is: `hangar.json` records its path in `code`, and the Hangar folder keeps only its notes and assets. You (or Claude) can edit `hangar.json` by hand; Hangar notices.

## What it does

- **Add projects** from GitHub (your repos, or paste any link), from a folder on this Mac (drop it in, choose it, or pick from the ones Hangar finds in `~/Developer`, `~/Projects`, `~/Code` and friends), or start a new one from a template. Hangar detects the type — Vite, Next.js, Tauri, Electron, Swift, Python, Rust, Go, static sites, a `run.sh` — and fills in the preview command.
- **Preview** starts by itself when you open the tab and stops when you leave it, and everything shows inside the preview box. Web pages show live at desktop, tablet or phone width; games can open 2 or 4 players side by side; scripts show their output. Missing `node_modules` are installed first.
- **Desktop apps preview inside the box too**, two ways:
  - **Interface**: the app runs as usual (backends and all), its own window is hidden, and its web interface shows in the box. The default for Tauri apps such as QuantApp.
  - **Window**: a live view of the app's real window, at its real size. Click it to use the app right there: Hangar moves the window exactly over the box and brings it forward; click anywhere else in Hangar to come back. The default for Electron and native apps.
  - The first time, macOS asks for two permissions in System Settings → Privacy & Security: **Screen & System Audio Recording** (to show the window) and **Accessibility** (to use it in place). Hiding windows also asks to control System Events.
- **Launch** opens the real, finished thing: the installed app, the live site, or a command in Terminal.
- **Open in** Claude Code, VS Code or Cursor, Terminal, Finder or GitHub.
- **Repository**: browse files, upload by dragging in, delete (two clicks), switch or create branches, pull, and one-line Commit & Push for changes made in your editor or by Claude. Uploads and deletes commit only those files and push for you. Releases: draft, upload builds, publish.
- **Repo settings**: rename, public/private, archive, delete (type the name to confirm), or create the GitHub repo for a project that doesn't have one.
- **Notes** in Markdown with `[[Project]]` links and tickable checkboxes, saved as you type.
- **Assets**: designs, videos and 3D models next to the code, out of git.
- **⌥Space** opens the launcher from anywhere; **⌘K** searches inside the app.

Keyboard: ⌘K search · ⌘1 all projects · ⌘N add project · ⌘L launch this project · in the launcher, ↵ Claude Code, ⌘↵ editor, ⌘L launch, ⌘K actions.

## GitHub

Hangar talks to GitHub only through the `gh` CLI, so it never stores a password or token. Deleting a repo needs one extra permission: `gh auth refresh -h github.com -s delete_repo`.

## Develop

```bash
npm test          # unit tests: detection, git, the vault, previews, discovery
npm run typecheck
npm run e2e       # drives the real app with Playwright and saves screenshots (needs `npm i -D playwright`)
```

```
src/main/       Electron main process: vault (projects on disk), git, gh, preview runner, Open in / Launch
src/preload/    the bridge: a fixed list of calls, nothing else
src/renderer/   React UI (main window and the ⌥Space launcher)
src/shared/     types shared by both sides
```

## Not built yet

- Typing and clicking straight into the live window view without bringing the real window forward.
- Mirroring an Android phone with `scrcpy`.
- Screenshots of the preview after each push, as a visual history.
