# Browser automation

Use `brmux` for Browmux pages. The existing c-cdp Chrome instance is separate.

## Start a bot session

```sh
brmux new-session -s agents --profile bot
brmux list-windows -t agents
brmux list-panes -t <window-id>
brmux tab new --pane <pane-id> https://example.com
```

Every response is JSON. Keep the returned tab ID for subsequent commands. New tabs created by the CLI do not change the pane's selected tab. `tab select` changes the shared pane selection explicitly. `attach-session` opens a visible client; omit it for unattended work.

```sh
brmux navigate -t <tab-id> https://example.com
brmux wait -t <tab-id> --selector 'main' --timeout 15000
brmux dom -t <tab-id>
brmux dom -t <tab-id> --html
brmux eval -t <tab-id> 'document.title'
brmux eval -t <tab-id> --file /absolute/path/to/script.js
brmux click -t <tab-id> --selector 'button[type=submit]'
brmux type -t <tab-id> --selector 'input[name=query]' --text 'browser layouts'
brmux key -t <tab-id> Enter
brmux key -t <tab-id> Meta+A
brmux screenshot -t <tab-id> --output /tmp/page.png
brmux screenshot -t <tab-id> --output /tmp/viewport.png --viewport
```

`type` inserts text at the focused input's cursor; it does not clear the field first. CSS selectors address the main document. Use raw CDP for frame-specific actions, file uploads, or more advanced operations.

```sh
brmux cdp -t <tab-id> Page.getLayoutMetrics
brmux cdp -t <tab-id> Runtime.evaluate '{"expression":"document.title","returnByValue":true}'
brmux rpc wait '{"tab":"<tab-id>","expression":"document.readyState === \"complete\"","timeout":15000}'
```

Raw CDP uses Electron's debugger connection and returns the protocol result. This is a per-tab command interface, not an external Playwright connection endpoint. Browser method calls are serialized per tab. Independent tabs can be controlled concurrently; agents should use separate tabs to avoid interfering with one another.

The screenshot path is returned after the PNG is written. Full-page capture includes the current document below the viewport without changing the native client selection. It does not load every item on infinite-scroll pages automatically.

DOM extraction and JavaScript evaluation can return sensitive page data; do not print credentials or unrelated private data. Browser content never receives access to the CLI socket. Profiles separate browser storage, but the current-user CLI can operate all profiles.

Close only the tabs you created when finished:

```sh
brmux tab close -t <tab-id>
```

Closing a pane's last tab creates an empty replacement. `kill-pane` removes the pane; `--confirm` is required if it contains multiple tabs. Tabs are persistent by default and do not have automatic agent leases in v1.

Use `BROWMUX_DATA_DIR` for a separate instance when testing. Never point Browmux at a Chrome or Brave profile directory.
