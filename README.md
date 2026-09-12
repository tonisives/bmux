# bmux

<img src="design/app-icon.png" alt="bmux Little lantern icon" width="100" />

### tmux for your browser.

Split panes. Persistent sessions. Isolated profiles. bmux is a macOS Chromium browser for people who live at the keyboard, with a CLI for background browser automation.

[Website](https://bmux.tonis.dev) · [Get started](#get-started) · [Keyboard shortcuts](#keyboard) · [Automation guide](AGENT.md)

[![bmux — tmux for your browser, illustrated workspace](https://bmux.tonis.dev/cdn/og.png)](https://bmux.tonis.dev)

## Features

- **Split your workspace** — Keep docs, dashboards, and apps side by side. Save and restore named layouts.
- **Persistent sessions** — Detach a client while its pages keep running. Reattach to the same live pages and form state.
- **Isolated profiles** — Separate logins, cookies, storage, and permissions. Use different profiles in the same layout.
- **Keyboard control** — A tmux-style prefix, transient command prompt, and familiar macOS tab shortcuts.
- **Quiet interface** — Native Chromium page content above one status bar. Controls appear when needed.
- **Background automation** — Navigate, inspect, click, type, evaluate JavaScript, and take screenshots through `bmux` without stealing focus.
- **Bring your bookmarks** — Import Brave profile names and bookmark folders while preserving their structure.
- **Live configuration** — Customize keyboard bindings in YAML without restarting the app.
- **Browser tools** — Ad/tracker blocking, Dark Reader, encrypted saved forms, Bitwarden CLI filling, and local userscripts. See [Browser tools](BROWSER-TOOLS.md).
- **Script plugins** — Add local actions and page hooks in any language, with DOM access and native prompts. See [Plugin authoring](PLUGINS.md).

bmux is an early preview, free under the [MIT license](LICENSE). Current builds are unsigned and built locally. It does not require tmux.

## Made for agents

Give your agents a browser that stays out of your way. With bmux, they can navigate real Chromium pages, inspect the DOM, run JavaScript, click, type, and capture screenshots through a CLI with JSON output and explicit tab IDs. Isolated profiles keep logins separate, while bot profiles keep background pages running. Split panes and saved layouts make it easy to follow their work. Detach and reconnect to live sessions whenever you need to, without background commands stealing your focus.

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

This installs `bmux.app` into `~/workspace/_tools`. Packaging does not restart a running instance. Add this checkout's `bin` directory to your PATH to use `bmux` from any terminal, or run `./bin/bmux` directly.

Try Control+B, then `%` to split a pane, `s` to switch sessions, or `?` for help. Command+L opens the URL prompt.

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

The product website lives in [`website/`](website/README.md). Run `pnpm site:dev` for its local preview and `pnpm site:build` for a pre-rendered production build.

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

Optionally add this checkout's `bin` directory to PATH; the `bmux` wrapper invokes the CLI. Browser commands silently start the server when needed. `attach-session` and `activate-client` intentionally show a client; navigation and screenshot commands do not.

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

## Import Brave profiles and bookmarks

```sh
bmux import-brave
```

This copies profile names and bookmark folders from Brave into separate bmux profiles and sessions. Use the session switcher to choose an imported profile, then run `bookmarks` in the command prompt (Control+B, then `:`). Imports preserve folders and leave Brave unchanged. A name collision creates a separate name such as `bot (Brave)`; it does not reuse another profile's storage. Repeating the import updates the imported bookmarks without duplicating profiles or sessions. An existing state file is backed up before import.

Use `import-brave` in the command prompt to repeat the import. `--source` selects another Brave user-data directory. Website logins, saved passwords, site data, extensions, and Brave settings are not copied. Unsupported URLs, such as bookmarklets, are preserved but disabled in the panel.

## Keyboard

The default prefix is Control+B, followed within 1.6 seconds by:

| Key | Action |
| --- | --- |
| c | New internal window |
| n / p | Next / previous internal window |
| % | Split pane horizontally (side by side) |
| " | Split pane vertically (above and below) |
| o | Next pane |
| z | Toggle the selected pane between split and full-window views |
| s | Show sessions |
| : | Open command prompt |
| ? | Show help and shortcuts |
| , / r | Rename internal window |
| & | Close internal window (y confirms; n or Escape cancels) |
| $ | Rename session |
| ( / ) | Previous / next session |
| d | Detach client |

In the session picker (Control+B, then s), type or press `/` to search session names. Up/Down moves the highlight and Enter attaches. Home/End jumps to the ends while a row is focused; PageUp/PageDown moves ten rows. The current session is focused when the picker opens. Escape clears the search first; another Escape closes without switching.

The tab picker (`tabs` in the command prompt, or click `profile:` in the status bar) starts with the active tab focused and uses the same keyboard controls. Search matches titles and URLs in the selected pane, keeping the original tab indices. Enter selects the highlighted tab, or the first result while typing. To open it with a direct shortcut, assign a binding to `tabs` in your keyboard config.

The `bookmarks` picker searches titles, URLs, and folder names within the selected pane's profile. Matching bookmarks retain their folder context. Up/Down moves between supported bookmarks and Enter opens a new tab. Escape clears the search before closing. Picker searches support case-insensitive fuzzy matching and multiple terms in any order.

Command+F opens Find in the status bar and searches as you type, showing the current match and total count. Enter or Next moves forward; Shift+Enter or Previous moves backward. Escape clears the highlights and restores page focus. Find stays responsive during background CLI waits and refreshes after navigation.

Command+Shift+W closes the native client and keeps its session running. Control+B then & closes the selected internal window and its tabs after confirmation; closing the last one leaves a new empty window. Control+B then , or r opens a rename prompt prefilled with the current name. Names can contain spaces and quotes.

Each pane has its own compact address bar above the page. Click a pane's address or press Command+L to edit the selected pane's URL, then press Enter to navigate. Control+B then z toggles the selected pane between the split layout and a full-window view without changing the saved split. The separate status bar keeps sessions, windows, and commands available while entering a URL; it sits at the top by default and follows the `statusBar` setting. Command+T creates a tab and opens the prompt, Command+W closes a tab, Command+R reloads, and Command+F opens find. Command+Shift+] / [ switches tabs. F1 also opens help. Escape dismisses prompts and panels. Drag an empty part of the status bar to move the native window.

Generated window names (`main` and `window-N`) follow the selected pane's active page domain, including when switching panes or tabs. Background tabs do not change the name. If several clients show the same window, the focused client determines its name; without a client, the first pane does. A name set explicitly with the rename prompt or `rename-window` is preserved. The `profile:default` item after the window list identifies the selected pane's browser profile: its isolated cookies, logins, and site storage. Click it to open that pane's tabs.

Control+B then `:` opens a fuzzy command finder. You can also click `:` in the
status bar. Type part of a command or description, such as `brtls` for
`browser-tools`. Up/Down or Control+P/N selects a result, Tab completes it, and
Enter opens or runs it. Commands requiring arguments complete into the prompt.
Enabled plugin actions and your active shortcuts appear in the results.

Complete commands and URLs run as typed. Shift+Enter always runs the typed text
exactly. Commands use the selected session/window/pane/tab by default. Examples:

```text
open https://example.com
new-session -s work --profile professional
session personal
new-window -n research
select-window -t 1
split-window -h --profile bot
pane-left
pane-down
pane-up
pane-right
save-layout development
restore-layout development --confirm
bookmarks
sessions
tabs
activity
help
```

Use quotes around names with spaces. Window/tab indices start at 0. Control+R/S
recalls earlier/later command history. Command+Shift+N creates another client. Set
the prefix with `prefix LETTER` or `bmux settings prefix LETTER`.

Open `?` (or F1), then press `/` to search help. Search filters commands, active
keybindings, and usage notes. Escape clears the search first; another Escape
closes help.

## Keyboard configuration

Edit `~/.config/bmux/config.yaml`, or press Command+, to view settings and open the file. Changes reload automatically; invalid YAML retains the last working configuration and reports the error. Help shows the active bindings.

```yaml
statusBar: top
accessibility: false
keyboard:
  prefix: Ctrl+B
  prefixTimeoutMs: 1600
  shortcuts:
    Cmd+R: reload
    Cmd+Shift+R: hard-reload
    Cmd+L: address
    Cmd+N: new-client
    Cmd+T: new-tab
    Cmd+W: close-tab
    Cmd+Shift+W: detach
    Cmd+F: find
    Cmd+,: settings
    Escape: stop
  prefixBindings:
    ":": command
    "?": help
    c: new-window
    ",": rename-window
    "&": close-window
    "$": rename-session
    "(": previous-session
    ")": next-session
```

Set `statusBar: bottom` to place the bar below page content. The default is `top`, and changes apply live.

Omitted bindings use defaults. Set a binding to `null` to disable it. Defaults also include history navigation with Command+[ / ], tab switching with Command+Shift+[ / ] or Control+Tab, and zoom with Command+plus/minus/0. Standard copy, paste, cut, select-all, and undo remain native macOS editing commands. Use `reload-config` to reload explicitly, `edit-config` to open the file, or `prefix LETTER` to update the prefix.

Multiple shortcuts can point to the same action. For example, adding `Cmd+Z: toggle-pane-zoom` under `keyboard.shortcuts` keeps the prefix binding while also providing a direct shortcut. This explicitly replaces native Undo for Command+Z inside bmux.

Mouse back/forward buttons navigate the page under the pointer, alongside the default Command+[/] history bindings. The mouse buttons still navigate history when Command+[/] is customized for window switching.

`BMUX_CONFIG` selects an explicit configuration file. Normal instances respect `XDG_CONFIG_HOME`; isolated `BMUX_DATA_DIR` instances use their own `config.yaml` so tests never alter personal settings.

Window switching, reload, stop, and keyboard commands remain responsive during navigation. URL submission starts loading immediately; a slow request does not hold the command prompt open or block another internal window. CLI `navigate` continues to wait for loading by default; use `--waitUntil none` for immediate return.

## oVim and accessibility

Electron can expose page links, buttons, and inputs through macOS accessibility. Set `accessibility: true` at the top of bmux's config to enable this explicitly; it reloads live and applies after relaunch. The default is automatic detection (`false`), so isolated bot instances do not force accessibility tree construction.

For oVim click mode, allow sufficient traversal depth in oVim's settings. Grafana's login controls were 18–23 levels deep in Chromium's tree; a `click_mode.max_depth` of 10 missed them. Raising it to 30 and enabling bmux accessibility exposed the login controls. oVim currently requires a restart to load its YAML changes. No extension is required for native accessibility hints; canvas-only controls still depend on the website providing accessible elements.

Personal window-switching overrides can use `Cmd+[: previous-window` and `Cmd+]: next-window` under `keyboard.shortcuts`; these replace history navigation only in that config. The application's default bindings remain unchanged.

Pane movement actions are `pane-left`, `pane-down`, `pane-up`, and `pane-right`. They follow the visible split layout and can be assigned to direct shortcuts such as Command+H/J/K/L or to prefix bindings. `split-right` and `split-down` can likewise be assigned to direct shortcuts while the tmux-style prefix defaults remain available.

On macOS, pane movement shortcuts also move the pointer to the center of the newly selected pane's page content, below its URL bar. This lets oVim's mouse-wheel-based `j/k` scrolling follow keyboard pane selection. Mouse clicks, background automation, and shortcuts with no neighboring pane leave the pointer in place. CLI pane selection does not move the pointer unless explicitly requested with `movePointer: true` in its RPC arguments.

## Data and permissions

Application state and profile partitions live under `~/Library/Application Support/bmux`. Set `BMUX_DATA_DIR` to an absolute path to run an isolated instance. Tests use disposable directories and never use your real profiles.

On first launch, bmux moves existing Browmux application data and `~/.config/browmux/config.yaml` into the new bmux paths. The previous `BROWMUX_DATA_DIR`, `BROWMUX_CONFIG`, and `BROWMUX_APP` environment variable names remain accepted.

Layouts, profiles, open URLs, zoom, and client selections are persisted. Relaunching reopens pages; it does not reconstruct arbitrary JavaScript memory or unsaved forms. Named layout restoration replaces a window's pages and requires confirmation.

Permissions are requested in the Activity panel and saved by profile, origin, and permission. Background requests wait there; they do not open a foreground window. CLI users can use `permission list` and `permission respond ID --allow` (omit `--allow` to deny). Downloads go to the standard Downloads directory using unique filenames, with status in Activity.

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

Every `pnpm package` installs the completed app at `~/workspace/_tools/bmux.app`, replacing the previous bundle after the new build succeeds. The `release/` directory is temporary packaging output. Packaging does not restart a running app; reopen it to use the new build. This is a local unsigned build, not a notarized public release. The CLI automatically uses the installed app; `BMUX_APP` can override it:

```sh
# Optional override: export BMUX_APP=/absolute/path/to/bmux.app
bmux attach-session -t main
```

## Current boundaries

Local script plugins are available through the `plugins` command and `bmux plugin` CLI. They are explicitly enabled in YAML and run with your OS privileges. The bundled Bitwarden desktop plugin is experimental; see its [verification status](examples/plugins/experimental.bitwarden/README.md).

No Chrome extensions, external Chrome/Brave embedding, or cloud synchronization. Website recoloring, ad blocking, and stored fills are described in [Browser tools](BROWSER-TOOLS.md). JavaScript alert/confirm/prompt dialogs are disabled so pages cannot steal focus; permission requests use bmux's Activity flow. Full-page screenshots capture the currently rendered document; lazy content may require scrolling first. Pages exceeding 80 megapixels require a viewport capture or an explicit CDP clip.

Do not expect Electron to provide every Chrome feature: DRM media, platform authentication integrations, and sites that reject embedded browsers may require additional work.
