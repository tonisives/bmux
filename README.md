# bmux

<img src="design/app-icon.png" alt="bmux Little lantern icon" width="100" />

### tmux for your browser.

Split panes. Persistent sessions. Isolated profiles. bmux is a macOS Chromium browser for people who live at the keyboard, with a CLI for background browser automation.

[Website](https://bmux.tonis.dev) · [Get started](#get-started) · [Keyboard shortcuts](KEYBOARD.md) · [Automation guide](AGENT.md)

[![Three Chromium panes in bmux, each with its own address bar](https://cdn.digthree.tonis.dev/bmux/website-73973cd36e3f/product/split-panes.png)](https://bmux.tonis.dev/#split-panes)

## Features

- **Split your workspace** — Keep docs, dashboards, and apps side by side. Save and restore named layouts.
- **Persistent sessions** — Detach a client while its pages keep running. Reattach to the same live pages and form state.
- **Isolated profiles** — Separate logins, cookies, storage, and permissions. Use different profiles in the same layout.
- **Keyboard control** — A tmux-style prefix, command prompt, and familiar macOS shortcuts. See [Keyboard](KEYBOARD.md).
- **Quiet interface** — Native Chromium page content above one status bar. Controls appear when needed.
- **Background automation** — Navigate, inspect, click, type, evaluate JavaScript, and take screenshots through `bmux` without stealing focus.
- **Bring your bookmarks** — Import Brave profile names and bookmark folders. See [Import from Brave](BRAVE.md).
- **Live configuration** — Customize keyboard bindings in YAML without restarting the app.
- **Browser tools** — Ad/tracker blocking, Dark Reader, encrypted saved forms, Bitwarden CLI filling, and local userscripts. See [Browser tools](BROWSER-TOOLS.md).
- **Script plugins** — Add local actions and page hooks in any language, with DOM access and native prompts. See [Plugin authoring](PLUGINS.md).

bmux is an early preview, free under the [MIT license](LICENSE). Current builds are unsigned and built locally. It does not require tmux.

### Switch sessions

Keep a workspace for each project.

[![The bmux session picker showing development, research and personal workspaces](https://cdn.digthree.tonis.dev/bmux/website-73973cd36e3f/product/switch-sessions.png)](https://bmux.tonis.dev/#switch-sessions)

## Made for agents

Give your agents a browser that stays out of your way. With bmux, they can navigate real Chromium pages, inspect the DOM, run JavaScript, click, type, and capture screenshots through a CLI with JSON output and explicit tab IDs. Isolated profiles keep logins separate, while bot profiles keep background pages running. Split panes and saved layouts make it easy to follow their work. Detach and reconnect to live sessions whenever you need to, without background commands stealing your focus.

[![A task added through the bmux CLI in the bot pane while the human pane stays selected](https://cdn.digthree.tonis.dev/bmux/website-73973cd36e3f/product/run-agent.png)](https://bmux.tonis.dev/#agents)

## Get started

Requires macOS, Node.js 22.12+ (Node 24 recommended), and pnpm 11.

```sh
git clone https://github.com/tonisives/bmux.git
cd bmux
pnpm install
pnpm dev
```

To build and install the app locally:

```sh
pnpm package
```

This writes the app to `build/bmux.app`. Set `BMUX_OUTPUT_DIR` to choose another output folder. Packaging does not restart a running instance. Add this checkout's `bin` directory to your PATH to use `bmux` from any terminal, or run `./bin/bmux` directly.

Try Control+B, then `%` to split a pane, `s` to switch sessions, or `?` for help. See [Keyboard](KEYBOARD.md) for more shortcuts.

## Downloads

Run `downloads` in the command prompt to manage transfers for the selected
pane's profile. Active transfers also appear as a `downloads:N` status-bar
button. The panel shows transferred bytes, total size when known, and completed,
paused, cancelled, or failed states. Pause, resume where available, or cancel
active transfers; use Show in Finder for completed files. Resume behavior
[depends on the server](https://www.electronjs.org/docs/latest/api/download-item#downloaditemresume).

Downloads save automatically to the macOS Downloads folder with unique filenames,
without a dialog stealing focus. The list lasts for the running browser process;
completed files remain on disk after quitting. The manager is also available in
`activity`, and `downloads` can be assigned a keyboard shortcut in config.yaml.

```sh
bmux downloads --profile PROFILE_ID
bmux download pause DOWNLOAD_ID --profile PROFILE_ID
bmux download resume DOWNLOAD_ID --profile PROFILE_ID
bmux download cancel DOWNLOAD_ID --profile PROFILE_ID
bmux download reveal DOWNLOAD_ID --profile PROFILE_ID
```

## Model

| Term | Meaning |
| --- | --- |
| Profile | Persistent cookies, site storage, cache, and permission choices |
| Session | Named collection of internal windows |
| Window | Named layout of browser panes |
| Pane | One profile, with its own browser tab |
| Client | A macOS window attached to a session |

Clients choose their current internal window independently. Visible clients keep their live browser views when the app loses focus. If multiple clients display the same page, focusing one transfers that page to it; the others show captured previews. Clients displaying different pages can render them simultaneously. Moving a view between clients preserves the actual page, form state, and JavaScript state. Detaching the last client leaves the server and pages running. **Quit** stops the browser.

Panes can mix profiles within a layout. Panes with the same profile share logins; different profiles have separate site storage. A pane's profile is fixed for its lifetime. Create a new pane to use another profile.

## Development

Requires macOS, Xcode Command Line Tools, Node.js 22.12+ (Node 24 recommended), and pnpm 11. The build compiles the bundled native pointer integration; installed apps do not need developer tools.

```sh
pnpm install
pnpm dev
```

The renderer reloads during development. Browser content runs sandboxed, without Node integration or a privileged preload. The application interface has a narrow IPC bridge.

See [TODO.md](TODO.md) for the development backlog and recently completed work.

Local GUI tests run inside a Tart macOS VM whose viewer stays on AeroSpace workspace
`bot`. Run `pnpm vm:setup` once, then use `pnpm test:electron` and `pnpm test:ui` as
usual. See [the Tart test setup](docs/tart-tests.md) for installation under
`/Volumes/sam`, test artifacts, and VM controls.

The product website is at [bmux.tonis.dev](https://bmux.tonis.dev). Its source and deployment are maintained separately from this browser repository.

Build and launch locally:

```sh
pnpm build
pnpm start
```

Use the repository CLI without a global installation:

```sh
./bin/bmux.mjs --help
./bin/bmux.mjs status
./bin/bmux.mjs attach-session -t main
```

Optionally add this checkout's `bin` directory to PATH; the `bmux` wrapper invokes the CLI. Browser commands silently start the server when needed. `attach-session` and `activate-client` intentionally show a client; navigation and screenshot commands do not. Activating an already-focused client preserves its focused page, text caret, or prompt.

The previous `brmux` command remains as an alias for existing scripts.

## Basic workflow

```sh
bmux profile create work
bmux new-session -s project-a --profile work
bmux attach-session -t project-a
bmux list-windows -t project-a
bmux list-panes -t <window-id>
bmux split-window -t <pane-id> -h --profile bot
bmux new-window -t project-a -n monitoring
bmux select-window -c <client-id> -t <window-id>
bmux save-layout -t <window-id> -n development
bmux restore-layout -t <window-id> -n development --confirm
```

CLI output is JSON: `{ "ok": true, "result": ... }`. Errors use `ok: false`, an error message, and a nonzero exit code. Browser actions require an explicit tab ID; IDs are returned by `tab list` and creation commands. A tab ID stays stable across view transfers and session restarts. A page reload or process crash can reset JavaScript state even though the application tab ID remains the same.

The `default` profile throttles inactive pages. The `bot` profile keeps background pages running. Additional bot profiles can be created using `profile create NAME --background`. A bot profile is a browser storage partition with a background-execution policy, not an OS user account or an authorization boundary against the local CLI.

## Guides

- [Keyboard shortcuts and configuration](KEYBOARD.md)
- [Import profiles and bookmarks from Brave](BRAVE.md)
- [Browser tools](BROWSER-TOOLS.md)
- [Plugin authoring](PLUGINS.md)
- [Browser automation](AGENT.md)

## Data and permissions

Application state and profile partitions live under `~/Library/Application Support/bmux`. Set `BMUX_DATA_DIR` to an absolute path to run an isolated instance. Tests use disposable directories and never use your real profiles.

On first launch, bmux moves existing Browmux application data and `~/.config/browmux/config.yaml` into the new bmux paths. The previous `BROWMUX_DATA_DIR`, `BROWMUX_CONFIG`, and `BROWMUX_APP` environment variable names remain accepted.

Layouts, profiles, open URLs, zoom, and client selections are persisted. Relaunching reopens pages; it does not reconstruct arbitrary JavaScript memory or unsaved forms. Named layout restoration replaces a window's pages and requires confirmation.

Pending permissions appear in a small top-right popup in the focused browser window. The website stays interactive and keeps keyboard focus, so you can keep browsing or ignore the request. Requests are shown one at a time with Allow and Deny buttons; choices are saved by profile, origin, and permission. Close dismisses the current queue without deciding it; pending requests remain in Activity, accessible from the permission count in the status bar. New requests show the popup again. Background requests do not activate the app. CLI users can use `permission list` and `permission respond ID --allow` (omit `--allow` to deny). Downloads go to the standard Downloads directory using unique filenames, with status in Activity.

The control socket is accessible only to the current OS user. No network debugger port is exposed by default. See [AGENT.md](AGENT.md) for browser automation.

## Verification and packaging

```sh
pnpm check
pnpm test:electron
pnpm test:ui
pnpm package
pnpm test:package
```

The UI check types a local fixture URL into a pane's URL prompt, submits Enter, verifies the native page is attached and visible, and saves `artifacts/url-opened.png`. It also opens a second pane and saves `artifacts/pane-addresses.png` with both address bars and the separate window status bar. `pnpm debug:ui` runs the same check and leaves the debug window open with temporary profiles. Set `BMUX_TEST_URL` to check a different URL.

Integration tests open disposable Electron clients, exercise native view transfers, verify isolated storage and restart recovery, and check that bot automation preserves the frontmost macOS application. They produce a client screenshot under `artifacts/`.

Every `pnpm package` writes the completed app to `build/bmux.app`, replacing the previous bundle only after the new build succeeds. The `release/` directory is temporary packaging output. Packaging does not restart a running app; reopen it to use the new build. This is a local unsigned build, not a notarized public release. The CLI uses the app in the build folder, then falls back to an existing `~/workspace/_tools/bmux.app`. `BMUX_APP` can override the app path:

```sh
# Optional override: export BMUX_APP=/absolute/path/to/bmux.app
bmux attach-session -t main
```

## Custom output folder

`BMUX_OUTPUT_DIR` chooses the folder containing `bmux.app`. Relative paths are resolved from the checkout; use an absolute path for a shared tools directory:

```sh
BMUX_OUTPUT_DIR="$HOME/workspace/_tools" pnpm package
```

Other files in that folder are preserved. Keep `BMUX_OUTPUT_DIR` set when using the CLI, or set `BMUX_APP` to the resulting app:

```sh
export BMUX_APP="$HOME/workspace/_tools/bmux.app"
bmux attach-session -t main
```

## Current boundaries

Local script plugins are available through the `plugins` command and `bmux plugin` CLI. They are explicitly enabled in YAML and run with your OS privileges. The example Bitwarden desktop plugin is experimental; see its [verification status](examples/plugins/experimental.bitwarden/README.md).

No Chrome extensions, external Chrome/Brave embedding, or cloud synchronization. Website recoloring, ad blocking, and stored fills are described in [Browser tools](BROWSER-TOOLS.md). JavaScript alert/confirm/prompt dialogs are disabled so pages cannot steal focus; permission requests use bmux's Activity flow. Full-page screenshots capture the currently rendered document; lazy content may require scrolling first. Pages exceeding 80 megapixels require a viewport capture or an explicit CDP clip.

Do not expect Electron to provide every Chrome feature: DRM media, platform authentication integrations, and sites that reject embedded browsers may require additional work.
