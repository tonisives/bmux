# bmux

<img src="https://cdn.digthree.tonis.dev/bmux/website-393d5cd162d9/icon-128.png" alt="bmux Little lantern icon" width="100" />

### A browser for people and agents

tmux for your browser. Split your work into panes, keep a workspace for each project, and give agents a browser you can see. bmux uses Chromium, with isolated profiles and a CLI for background browser automation.

[Website](https://bmux.cc) · [Download](https://github.com/tonisives/bmux/releases/latest) · [Get started](#get-started) · [Build from source](#development) · [Automation guide](docs/agent.md)

bmux is an early preview, free under the [GNU GPL version 3](LICENSE). The [original MIT notice](LICENSE-MIT) is retained for code previously distributed under MIT. macOS releases are Developer ID signed and notarized. It does not require tmux.

## Features

### Browser multiplexer

Split pages horizontally or vertically, keep references in floating panes, and save layouts to use again. Each pane has its own address bar and a fixed profile. Browse with a tmux-style prefix, scroll mode, and native click hints. Page content sits above one status bar; controls appear when needed.

[![Two split browser panes with Google Cloud pages and a floating documentation reference above them](https://cdn.digthree.tonis.dev/bmux/website-393d5cd162d9/gallery/browser-multiplexer.png)](https://bmux.cc/features/browser-multiplexer/)

[Watch the walkthrough](https://bmux.cc/features/browser-multiplexer/) · [Keyboard shortcuts](docs/keyboard.md) · [Floating panes](docs/floating-panes.md)

#### Switch sessions

Keep a named workspace for each project, research task, or agent workflow. Switch sessions to return to your pages and layout. Detach a client while its pages keep running, then reattach to the same live pages and form state.

### Agentic browsing

Control a specific pane from the shell: navigate, inspect the DOM, run JavaScript, click, type, and capture screenshots. Commands return JSON and run without taking your focus. Watch several agents in split panes, with separate profiles for their logins and a background profile to keep each worker's pages running.

[![Four independent browser panes with the commands controlling them visible below](https://cdn.digthree.tonis.dev/bmux/website-393d5cd162d9/gallery/agentic-browsing.png)](https://bmux.cc/features/agentic-browsing/)

[Watch the walkthrough](https://bmux.cc/features/agentic-browsing/) · [CLI and agent guide](docs/agent.md)

### Simulate mobile devices

Choose a Pixel, Galaxy, or iPhone preset for a pane and browse its mobile layout. Presets apply viewport dimensions, device pixel ratio, touch input, and browser identity settings. Switch orientation or customize the size, locale, timezone, and optional geolocation. The engine remains Chromium, including with an iPhone preset.

[![MDN documentation displayed inside a simulated phone in bmux](https://cdn.digthree.tonis.dev/bmux/website-393d5cd162d9/gallery/simulate-mobile-devices.png)](https://bmux.cc/features/simulate-mobile-devices/)

[Watch the walkthrough](https://bmux.cc/features/simulate-mobile-devices/) · [Device presets and profiles](docs/profiles.md#mobile-device-personas)

### Automated scraping

Give each worker its own background profile, HTTP/HTTPS or SOCKS5 proxy, and optional device preset. Use the CLI to scroll, read pages, and follow links while monitoring workers together. Connection settings and device presentation are independent. Run browser hosts on Linux and connect through the web viewer or desktop Remote sessions picker.

[![Four simulated mobile devices browsing separate pages, with worker commands underneath](https://cdn.digthree.tonis.dev/bmux/website-393d5cd162d9/gallery/automated-scraping.png)](https://bmux.cc/features/automated-scraping/)

[Watch the walkthrough](https://bmux.cc/features/automated-scraping/) · [Configure a proxy](docs/profiles.md#configure-a-proxy) · [Remote hosting](docs/remote-host.md)

### Browser tools

- **Find pages again** — Search profile-scoped history, save bookmark folders in YAML, or import profiles and bookmarks from a Chromium browser. See [Bookmarks](docs/bookmarks.md) and [Import from Chrome](docs/chrome.md).
- **Live configuration** — Customize keyboard bindings in YAML without restarting the app. See [Keyboard](docs/keyboard.md).
- **Page tools** — Ad/tracker blocking, Dark Reader, encrypted saved forms, Bitwarden browser extension, and local userscripts. See [Browser tools](docs/browser-tools.md).
- **Script plugins** — Add local actions and page hooks in any language, with DOM access and native prompts. See [Plugin authoring](docs/plugins.md).

## Get started

On macOS, install the latest release with Homebrew:

```sh
brew install --cask tonisives/tap/bmux
```

The [latest GitHub release](https://github.com/tonisives/bmux/releases/latest) also provides macOS Apple Silicon and Intel DMGs, a Windows x64 desktop installer, and Linux x64 and arm64 portable host archives. See [Remote hosting](docs/remote-host.md) for Linux host setup.

macOS releases are Developer ID signed and notarized. Installed release builds check for updates at startup and daily, download them in the background, and apply them when you quit. Use **bmux > Restart to Update** to restart sooner, or turn off **Automatically Check for Updates** in that menu. See [macOS launch troubleshooting](docs/packaging.md#macos-first-launch) for the v0.1.3 damaged-bundle error. The bundled `bmux` CLI requires Node.js 22.12+ (Node 24 recommended).

To run from source, install Node.js 22.12+ and pnpm 11:

```sh
git clone https://github.com/tonisives/bmux.git
cd bmux
pnpm install --frozen-lockfile
pnpm dev
```

See [Packaging](docs/packaging.md) for build artifacts and platform notes. Add this checkout's `bin` directory to your PATH to use `bmux` from any terminal, or run `./bin/bmux` directly.

Try Control+B, then `%` to split a pane, `s` to switch sessions, or `?` for help. See [Keyboard](docs/keyboard.md) for more shortcuts.

## Model

A session holds internal windows; each window contains split and floating panes. Desktop windows are clients attached to a session, each with its own selected internal window.

<img src="https://cdn.digthree.tonis.dev/bmux/docs-model-80daae29051b/workspace-model.svg" alt="Two clients select different windows in one session; panes using work share logins while bot has separate storage" width="800" />

| Term    | Meaning                                                         |
| ------- | --------------------------------------------------------------- |
| Profile | Persistent cookies, site storage, cache, and permission choices |
| Session | Named collection of internal windows                            |
| Window  | Named layout of browser panes                                   |
| Pane    | One browser page with a fixed profile                           |
| Client  | A desktop window attached to a session                          |

Profiles are independent of layouts. Panes using the same profile share logins; a pane's profile stays fixed.

<img src="https://cdn.digthree.tonis.dev/bmux/docs-model-80daae29051b/pane-lifecycle.svg" alt="Pane 2 floats above its split layout and docks again, keeping the same ID, work profile, and live page" width="800" />

Detach leaves pages running. **Quit** stops the browser. Restarting reopens saved URLs, but does not restore unsaved forms or JavaScript state.

See [session and client behavior](docs/architecture.md#sessions-own-pages-independently-of-desktop-windows), [profiles](docs/profiles.md), and [floating pane commands](docs/floating-panes.md).

## Development

Requires Node.js 22.12+ (Node 24 recommended) and pnpm 11. On macOS, install Xcode Command Line Tools for the native pointer integration. See [Platform notes](docs/platforms.md) for host-specific requirements.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The renderer reloads during development. Browser content runs sandboxed, without Node integration or a privileged preload. The application interface has a narrow IPC bridge.

See the [roadmap](docs/todo.md) for the development backlog and recently completed work.

The product website is at [bmux.cc](https://bmux.cc). Its source and deployment are maintained separately from this browser repository.

Build and launch locally:

```sh
pnpm build
pnpm start
```

On macOS, build an application bundle in `build/bmux.app`:

```sh
pnpm package
```

Use `BMUX_OUTPUT_DIR` to choose another output folder. Packaging does not restart a running app. See [Packaging](docs/packaging.md) for signing, installation, and other platform artifacts.

Use the repository CLI without a global installation:

```sh
./bin/bmux.mjs --help
./bin/bmux.mjs status
./bin/bmux.mjs attach-session -t main
```

Optionally add this checkout's `bin` directory to PATH; the `bmux` wrapper invokes the CLI. Browser commands silently start the server when needed. `attach-session` and `activate-client` intentionally show a client; navigation and screenshot commands do not. Activating an already-focused client preserves its focused page, text caret, or prompt.

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

For `list-panes`, you can also use a session name and one-based window index, such as `bmux list-panes -t main:5`.

CLI output is JSON: `{ "ok": true, "result": ... }`. Errors use `ok: false`, an error message, and a nonzero exit code. Browser actions require an explicit pane ID; `list-panes` and pane creation commands return those IDs. New panes use short numeric IDs such as `%1`, and closing a pane makes its number available again. Keep an ID only while its pane exists. An open pane's ID stays stable across view transfers and session restarts. A page reload or process crash can reset JavaScript state while the pane ID remains the same.

The `default` profile throttles inactive pages. The `bot` profile keeps background pages running. Additional bot profiles can be created using `profile create NAME --background`. A bot profile is a browser storage partition with a background-execution policy, not an OS user account or an authorization boundary against the local CLI.

Use `bmux memory` to inspect process memory and its pane/profile associations, or
`bmux memory --history` to inspect recent growth. See [memory diagnostics](docs/memory.md)
for sampling, units, and shared-process accounting.

## Guides

- [Floating panes and docking](docs/floating-panes.md)
- [Profiles, proxies, and device personas](docs/profiles.md)
- [Keyboard shortcuts and configuration](docs/keyboard.md)
- [Bookmarks and YAML storage](docs/bookmarks.md)
- [Import profiles and bookmarks from Chrome](docs/chrome.md)
- [Downloads](docs/downloads.md)
- [Browser tools](docs/browser-tools.md)
- [Plugin authoring](docs/plugins.md)
- [Browser automation](docs/agent.md)
- [Remote hosting and access](docs/remote-host.md)
- [Packaging](docs/packaging.md)
- [Platform notes](docs/platforms.md)

## Data and permissions

Application state and profile partitions use the platform's application-data directory. Set `BMUX_DATA_DIR` to an absolute path to run an isolated instance. Tests use disposable directories and never use your real profiles.

Bookmarks live in `~/.config/bmux/bookmarks.yaml`, alongside keyboard settings. See [Bookmarks](docs/bookmarks.md) for the format and migration details.

Layouts, profiles, open URLs, zoom, and client selections are persisted. Relaunching reopens pages; it does not reconstruct arbitrary JavaScript memory or unsaved forms. Named layout restoration replaces a window's pages and requires confirmation.

Permission requests appear in the focused window without taking focus from the page. Decisions are saved by profile, origin, and permission. Manage pending requests in Activity or with `permission list` and `permission respond`.

The control socket is accessible only to the current OS user. No network debugger port is exposed by default. See [Browser automation](docs/agent.md) for CLI usage.

## Current boundaries

Local script plugins are available through the `plugins` command and `bmux plugin` CLI. They are explicitly enabled in YAML and run with your OS privileges.

Experimental Chrome extension support, including Bitwarden installation, is described in [Browser extensions](docs/extensions.md). External Chrome/Brave embedding and cloud synchronization are not supported. Website recoloring, ad blocking, and stored fills are described in [Browser tools](docs/browser-tools.md). Website JavaScript alert, confirm, and prompt use native dialogs with protection against repeated dialogs; permission requests use bmux's Activity flow. Full-page screenshots capture the currently rendered document; lazy content may require scrolling first. Pages exceeding 80 megapixels require a viewport capture or an explicit CDP clip.

Do not expect Electron to provide every Chrome feature: DRM media, platform authentication integrations, and sites that reject embedded browsers may require additional work.

To make bmux your default browser, open Settings with `Cmd+,` in the installed
app and choose **Make bmux the default browser**. Confirm the macOS prompt if
shown. You can also select bmux in System Settings > Desktop & Dock > Default
web browser. Links from other apps open in a new internal window in the active bmux session.
