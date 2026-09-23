# Browser automation

Local plugins can contribute actions and hooks. See [Plugin authoring](plugins.md) for
the manifest, private host API, and isolated testing workflow. `bmux plugin run`
returns a run ID; `bmux plugin runs` reports completion. Do not print invocation
credentials or send secrets through command arguments or explicit plugin results.

Use `bmux` for bmux pages. The existing c-cdp Chrome instance is separate.

## Start a bot session

```sh
bmux new-session -s agents --profile bot
bmux list-windows -t agents
bmux list-panes -t <window-id>
bmux new-window -t agents -n audit --profile bot --url https://example.com
```

Every response is JSON. Keep the returned pane ID for subsequent commands. Create a
dedicated internal window or pane for independent work so concurrent agents do not
navigate the same page. `attach-session` opens a visible client; omit it for
unattended work.

```sh
bmux navigate -t <pane-id> https://example.com
bmux wait -t <pane-id> --selector 'main' --timeout 15000
bmux wait -t <pane-id> --selector '#results' --state visible
bmux wait -t <pane-id> --selector '.spinner' --state hidden
bmux wait -t <pane-id> --selector '.loading-overlay' --state detached
bmux wait -t <pane-id> --expression 'window.appReady === true'
bmux dom -t <pane-id>
bmux dom -t <pane-id> --html
bmux eval -t <pane-id> 'document.title'
bmux eval -t <pane-id> --file /absolute/path/to/script.js
bmux click -t <pane-id> --selector 'button[type=submit]'
bmux type -t <pane-id> --selector 'input[name=query]' --text 'browser layouts'
bmux key -t <pane-id> Enter
bmux key -t <pane-id> Meta+A
bmux screenshot -t <pane-id> --output /tmp/page.png
bmux screenshot -t <pane-id> --output /tmp/viewport.png --viewport
```

`type` inserts text at the focused input's cursor; it does not clear the field first. CSS selectors address the main document. Use raw CDP for frame-specific actions, file uploads, or more advanced operations.

`wait` accepts exactly one of `--selector`, `--expression`, or `--ms`. Selector waits
inspect the first match. The default state, `attached`, checks DOM presence;
`detached` waits for absence. `visible` requires a nonempty bounding box and CSS
visibility other than hidden or collapse. `hidden` also succeeds when the element
is absent. Opacity, viewport position, and which client displays the pane do not
affect this visibility check. These waits work on background panes without changing
client selections. Timeouts default to 15 seconds and are capped at 60 seconds;
invalid selectors, states, durations, and throwing expressions report errors.

```sh
bmux cdp -t <pane-id> Page.getLayoutMetrics
bmux cdp -t <pane-id> Runtime.evaluate '{"expression":"document.title","returnByValue":true}'
```

Raw CDP uses Electron's debugger connection and returns the protocol result. This is a per-pane command interface, not an external Playwright connection endpoint. Automation calls are serialized per pane. Human controls, including Find, view attachment, and navigation shortcuts, remain independent of that queue. Independent panes can be controlled concurrently.

The screenshot path is returned after the PNG is written. Full-page capture includes the current document below the viewport without changing the native client selection. It does not load every item on infinite-scroll pages automatically.

DOM extraction and JavaScript evaluation can return sensitive page data; do not print credentials or unrelated private data. Browser content never receives access to the CLI socket. Profiles separate browser storage, but the current-user CLI can operate all profiles.

Close only the pane or internal window you created when finished:

```sh
bmux kill-pane -t <pane-id>
bmux kill-window -t <window-id>
```

Panes are persistent by default. Automation policies may require a lease before
agent commands can access selected websites.

## Automation policies

Policies are optional and apply to the profile IDs and website hosts listed in
`automation.groups` in `config.yaml`. A group may contain several websites; they
share its concurrency and rolling hourly and daily budgets. Human commands from
the bmux window are exempt. Automation through the CLI and plugins needs an
active lease. `automation status` shows usage without exposing lease tokens.

```yaml
automation:
  groups:
    social:
      profiles: [profile_bot]
      hosts: [x.com, linkedin.com]
      maxConcurrent: 1
      hourly: { runs: 2, navigations: 30, activeMinutes: 20 }
      daily: { runs: 6, navigations: 100, activeMinutes: 60 }
      requiredPlugins:
        x.com: bmux.x
        linkedin.com: bmux.linkedin
      likesPerDay:
        x.com: 1
plugins:
  bmux.x: { enabled: true, hooks: false }
  bmux.linkedin: { enabled: true, hooks: false }
```

The `likesPerDay` entries explicitly enable automatic likes for those sites;
omitting a site keeps liking disabled. Use profile IDs from `bmux profile list`.
The X and LinkedIn plugins accept `urls` as a JSON array string and `topic` as a
phrase. They visit at most 20 supplied HTTPS URLs, pause and scroll during the
run, and may like one visible, unliked post per page whose text contains the
topic phrase. Like reservations count toward a rolling 24-hour cap even if the
page click fails. Neither plugin follows, reposts, comments, or messages.

```sh
bmux plugin run bmux.x/browse -t PANE_ID --parameters '{"urls":"[\"https://x.com/home\"]","topic":"customer discovery"}'
bmux plugin runs
bmux automation status
```

For a group without `requiredPlugins`, a script may acquire a lease on an
existing blank pane, then pass its token through `BMUX_AUTOMATION_LEASE` on each
browser command and release it when finished. The lease expires after five
minutes without a successful authorized command. The token is private; do not
include it in logs or shared output. Policies count a run on acquisition,
committed main-frame and same-document navigations, and active time through 30
seconds after automated navigation, scroll or click. A limit stops further
automation commands; start a new run after the rolling window permits it.

Use `BMUX_DATA_DIR` for a separate instance when testing. Never point bmux at a Chrome or Brave profile directory.
