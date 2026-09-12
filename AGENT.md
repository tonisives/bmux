# Browser automation

Local plugins can contribute actions and hooks. See [PLUGINS.md](PLUGINS.md) for
the manifest, private host API, and isolated testing workflow. `bmux plugin run`
returns a run ID; `bmux plugin runs` reports completion. Do not print invocation
credentials or send secrets through command arguments or explicit plugin results.

Use `bmux` for bmux pages. The existing c-cdp Chrome instance is separate.

## Start a bot session

```sh
bmux new-session -s agents --profile bot
bmux list-windows -t agents
bmux list-panes -t <window-id>
bmux tab new --pane <pane-id> https://example.com
```

Every response is JSON. Keep the returned tab ID for subsequent commands. New tabs created by the CLI do not change the pane's selected tab. `tab select` changes the shared pane selection explicitly. `attach-session` opens a visible client; omit it for unattended work.

```sh
bmux navigate -t <tab-id> https://example.com
bmux wait -t <tab-id> --selector 'main' --timeout 15000
bmux wait -t <tab-id> --selector '#results' --state visible
bmux wait -t <tab-id> --selector '.spinner' --state hidden
bmux wait -t <tab-id> --selector '.loading-overlay' --state detached
bmux wait -t <tab-id> --expression 'window.appReady === true'
bmux dom -t <tab-id>
bmux dom -t <tab-id> --html
bmux eval -t <tab-id> 'document.title'
bmux eval -t <tab-id> --file /absolute/path/to/script.js
bmux click -t <tab-id> --selector 'button[type=submit]'
bmux type -t <tab-id> --selector 'input[name=query]' --text 'browser layouts'
bmux key -t <tab-id> Enter
bmux key -t <tab-id> Meta+A
bmux screenshot -t <tab-id> --output /tmp/page.png
bmux screenshot -t <tab-id> --output /tmp/viewport.png --viewport
```

`type` inserts text at the focused input's cursor; it does not clear the field first. CSS selectors address the main document. Use raw CDP for frame-specific actions, file uploads, or more advanced operations.

`wait` accepts exactly one of `--selector`, `--expression`, or `--ms`. Selector waits
inspect the first match. The default state, `attached`, checks DOM presence;
`detached` waits for absence. `visible` requires a nonempty bounding box and CSS
visibility other than hidden or collapse. `hidden` also succeeds when the element
is absent. Opacity, viewport position, and which client displays the tab do not
affect this visibility check. These waits work on background tabs without changing
client selections. Timeouts default to 15 seconds and are capped at 60 seconds;
invalid selectors, states, durations, and throwing expressions report errors.

```sh
bmux cdp -t <tab-id> Page.getLayoutMetrics
bmux cdp -t <tab-id> Runtime.evaluate '{"expression":"document.title","returnByValue":true}'
bmux rpc wait '{"tab":"<tab-id>","expression":"document.readyState === \"complete\"","timeout":15000}'
```

Raw CDP uses Electron's debugger connection and returns the protocol result. This is a per-tab command interface, not an external Playwright connection endpoint. Automation calls are serialized per tab. Human controls, including Find, view attachment, and navigation shortcuts, remain independent of that queue. Independent tabs can be controlled concurrently; agents should use separate tabs to avoid interfering with one another.

The screenshot path is returned after the PNG is written. Full-page capture includes the current document below the viewport without changing the native client selection. It does not load every item on infinite-scroll pages automatically.

DOM extraction and JavaScript evaluation can return sensitive page data; do not print credentials or unrelated private data. Browser content never receives access to the CLI socket. Profiles separate browser storage, but the current-user CLI can operate all profiles.

Close only the tabs you created when finished:

```sh
bmux tab close -t <tab-id>
```

Closing a pane's last tab creates an empty replacement. `kill-pane` removes the pane; `--confirm` is required if it contains multiple tabs. Tabs are persistent by default and do not have automatic agent leases in v1.

Use `BMUX_DATA_DIR` for a separate instance when testing. Never point bmux at a Chrome or Brave profile directory.
