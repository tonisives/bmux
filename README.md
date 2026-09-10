# Browmux

A macOS browser built on Electron's Chromium engine, with tmux-style sessions and persistent, isolated profiles.

## Model

| Term | Meaning |
| --- | --- |
| Profile | Persistent cookies, site storage, cache, and permission choices |
| Session | Named collection of internal windows |
| Window | Named layout of browser panes |
| Pane | One profile, with its own browser tabs |
| Client | A macOS window attached to a session |

Clients choose their current internal window independently. The focused client hosts live browser views; other clients show captured previews. Moving a view between clients preserves the actual page, form state, and JavaScript state. Detaching the last client leaves the server and pages running. **Quit** stops the browser.

Panes can mix profiles within a layout. Panes with the same profile share logins; different profiles have separate site storage. A pane's profile is fixed for its lifetime. Create a new pane to use another profile.

## Development

Requires macOS, Node.js 22.12+ (Node 24 recommended), and pnpm 11.

```sh
pnpm install
pnpm dev
```

The renderer reloads during development. Browser content runs sandboxed, without Node integration or a privileged preload. The application interface has a narrow IPC bridge.

Build and launch locally:

```sh
pnpm build
pnpm start
```

Use the repository CLI without a global installation:

```sh
./bin/brmux.mjs --help
./bin/brmux.mjs status
./bin/brmux.mjs attach-session -t main
```

Optionally add this checkout's `bin` directory to PATH; the `brmux` wrapper invokes the CLI. Browser commands silently start the server when needed. `attach-session` and `activate-client` intentionally show a client; navigation and screenshot commands do not.

## Basic workflow

```sh
brmux profile create work
brmux new-session -s project-a --profile work
brmux attach-session -t project-a
brmux list-windows -t project-a
brmux list-panes -t <window-id>
brmux split-window -t <pane-id> -h --profile bot
brmux new-window -t project-a -n monitoring
brmux select-window -c <client-id> -t <window-id>
brmux save-layout -t <window-id> -n development
brmux restore-layout -t <window-id> -n development --confirm
```

CLI output is JSON: `{ "ok": true, "result": ... }`. Errors use `ok: false`, an error message, and a nonzero exit code. Browser actions require an explicit tab ID; IDs are returned by `tab list` and creation commands. A tab ID stays stable across view transfers and session restarts. A page reload or process crash can reset JavaScript state even though the application tab ID remains the same.

The `default` profile throttles inactive pages. The `bot` profile keeps background pages running. Additional bot profiles can be created using `profile create NAME --background`. A bot profile is a browser storage partition with a background-execution policy, not an OS user account or an authorization boundary against the local CLI.

## Keyboard

The default prefix is Control+B, followed within 1.6 seconds by:

| Key | Action |
| --- | --- |
| c | New internal window |
| n / p | Next / previous internal window |
| % | Split pane horizontally (side by side) |
| " | Split pane vertically (above and below) |
| o | Next pane |
| s | Focus session switcher |
| d | Detach client |

Command+L focuses the address bar, Command+T creates a tab, Command+W closes a tab, Command+R reloads, and Command+F focuses find. Command+Shift+N creates another client. Set the prefix in Help or with `brmux settings prefix LETTER`.

## Data and permissions

Application state and profile partitions live under `~/Library/Application Support/Browmux`. Set `BROWMUX_DATA_DIR` to an absolute path to run an isolated instance. Tests use disposable directories and never use your real profiles.

Layouts, profiles, open URLs, zoom, and client selections are persisted. Relaunching reopens pages; it does not reconstruct arbitrary JavaScript memory or unsaved forms. Named layout restoration replaces a window's pages and requires confirmation.

Permissions are requested in the Activity panel and saved by profile, origin, and permission. Background requests wait there; they do not open a foreground window. CLI users can use `permission list` and `permission respond ID --allow` (omit `--allow` to deny). Downloads go to the standard Downloads directory using unique filenames, with status in Activity.

The control socket is accessible only to the current OS user. No network debugger port is exposed by default. See [AGENT.md](AGENT.md) for browser automation.

## Verification and packaging

```sh
pnpm check
pnpm test:electron
pnpm package
pnpm test:package
```

Integration tests open disposable Electron clients, exercise native view transfers, verify isolated storage and restart recovery, and check that bot automation preserves the frontmost macOS application. They produce a client screenshot under `artifacts/`.

Packaging produces `release/mac-arm64/Browmux.app` on Apple Silicon (or `release/mac/Browmux.app` on Intel). This is a local unsigned build, not a notarized public release. To drive a packaged build:

```sh
export BROWMUX_APP=/absolute/path/to/Browmux.app
brmux attach-session -t main
```

## Current boundaries

No Chrome extensions, external Chrome/Brave embedding, imported browser profiles, cloud synchronization, website recoloring, or built-in ad blocking. The interface uses a dark theme; websites retain their own appearance. JavaScript alert/confirm/prompt dialogs are disabled so pages cannot steal focus; permission requests use Browmux's Activity flow. Full-page screenshots capture the currently rendered document; lazy content may require scrolling first. Pages exceeding 80 megapixels require a viewport capture or an explicit CDP clip.

Do not expect Electron to provide every Chrome feature: DRM media, platform authentication integrations, and sites that reject embedded browsers may require additional work.
