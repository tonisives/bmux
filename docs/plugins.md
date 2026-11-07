# bmux script plugins

An action can declare `pacing: plugin` to manage its own timing. BMUX then omits
the generic action pause and social-site delay for that run. Website access stays
exclusive to the run within its profile, across panes and agents, until completion,
cancellation or failure. Navigation locks both its source and destination. Other
profiles and websites can continue independently. Session limits, warnings,
automation groups and daily like budgets still apply. Actions without this setting
keep the configured BMUX pacing.

Use `observation: true` on read-only `eval` calls, including target preparation
that only returns coordinates. Send the actual click through browser input.

Plugins are local folders containing `plugin.yaml` and scripts in any language.
They can contribute actions, automatic hooks, browser operations, and transient
prompts. Scripts run as your OS user. Enable only code you trust: host capabilities
describe and restrict the host API, but do not sandbox filesystem, network, or
other programs the script can access. Pages retain Chromium's sandbox and receive
no Node integration or privileged preload.

## Scrolling

BMUX animates scroll commands and automated CDP wheel events by default. Each
move uses a sine velocity curve with varied speed and cadence. Some moves
overshoot slightly and correct to the requested distance when the container has
room. Keyboard scroll commands use the same animation. Trackpad input keeps its
native momentum. Reduced motion and modified wheels keep immediate input.

These settings reload from `~/.config/bmux/config.yaml`:

```yaml
scrolling:
  enabled: true
  randomize: true
  overshoot: true
```

`plugin host context` includes the current `scrolling` settings, even without
`refresh: true`. When `context.scrolling.enabled` is true, send one wheel event
for the intended distance and let BMUX animate it. Plugins should skip their own
scroll curve. The command resolves after the last animation input.

Both `scroll` and `cdp` accept a partial `scrolling` override alongside their
ordinary arguments. For a plugin that already produces its own wheel sequence:

```js
host('cdp', {
  method: 'Input.dispatchMouseEvent',
  params: { type: 'mouseWheel', x: 400, y: 300, deltaX: 0, deltaY: 500 },
  scrolling: { enabled: false },
})
```

Use `scrolling: { randomize: false }` for a consistent sine curve, or
`scrolling: { overshoot: false }` to vary the timing without reversing direction.
Overrides apply only to that call and inherit the other configured settings.

## Install and enable

Copy or symlink a plugin folder under `plugins/` beside the active config file,
normally `~/.config/bmux/plugins/`. Examples live in `examples/plugins/` in the
checkout and `bmux.app/Contents/Resources/plugins/` in packaged builds. There is
no automatic download or execution of bundled examples.

The X, LinkedIn, and Reddit browsing plugins live in `optional-plugins/` in the source
checkout. They are not included in bmux.app. Copy the desired plugin folder into the
active `plugins/` directory to install it; each folder is self-contained. Enable
the copied plugin in config as described below.

The Reddit browse action visits 1–10 HTTPS Reddit URLs, opens matching page links when
available, and scrolls each page. It does not post, vote, or join communities.
Configure an automation group for the intended profile before running it:

```yaml
plugins:
  bmux.reddit: { enabled: true, hooks: false }
automation:
  groups:
    reddit:
      profiles: [profile_bot]
      hosts: [reddit.com]
      maxConcurrent: 1
      hourly: { runs: 12, navigations: 30, activeMinutes: 20 }
      daily: { runs: 12, navigations: 100, activeMinutes: 60 }
      requiredPlugins: { reddit.com: bmux.reddit }
      likesPerDay: { reddit.com: 0 }
```

Each social plugin also has a `follow` action. Supply 1–10 explicit profile URLs:
X `/username`, LinkedIn `/in/username`, or Reddit `/user/username`. The action
skips profiles already followed and confirms the button changes to Following.
Follow attempts are capped at 10 per profile and site over a rolling seven days,
shared across runs and retained after restarts. An unconfirmed click still counts
as an attempt. Repeated targets are skipped during that week.

Lower the cap or disable following with `followsPerWeek` in the automation group:

```yaml
followsPerWeek: { reddit.com: 10 } # 0 disables following; maximum 10
```

```sh
bmux plugin run bmux.reddit/follow -t PANE_ID --parameters '{"urls":"[\"https://www.reddit.com/user/username\"]"}'
```

Replace `profile_bot` with your profile ID. If a desktop launch cannot find Node,
set the installed manifest's first command argument to the absolute path returned
by `command -v node`. The script uses that same Node executable for host calls.

```sh
bmux plugin run bmux.reddit/browse -t PANE_ID --parameters '{"urls":"[\"https://www.reddit.com/search/?q=browser+automation&type=posts\"]"}'
```

Merge these entries into your existing config (preserve your keyboard edits):

```yaml
keyboard:
  prefixBindings:
    P: plugins
plugins:
  local.page-tools:
    enabled: true
    hooks: false
```

Open **Extensions > Plugins** beside a pane’s profile icon to toggle plugins,
configure built-in tools, and run actions. The `plugins` command also opens the plugin list. `activity` shows
progress, failures, and cancellation controls. Manifests and config reload live;
scripts are read on the next invocation. `plugin reload` rescans immediately.
Plugin details use feature tabs and action buttons. Set an action’s optional `group`
to its feature name, such as `Browsing`, `Publishing`, or `Insights`. Ungrouped
actions appear under `Actions`; `Settings` and `Activity` remain separate tabs.
Descriptions wrap beside compact action buttons.

Action parameters support `section`, `description`, and `advanced: true` to group
the form and keep additional controls behind full configuration. Optional
`presets` contain an `id`, `title`, optional `description`, and a mapping of
parameter `values`. Choosing a preset fills the form; individual values remain
editable. Presets cannot contain hidden parameters or passwords.

For profile-specific saved values, `configuration_command` is an argument array
that prints one JSON object mapping parameter names to their effective values.
BMUX passes the active profile in `BMUX_PLUGIN_PROFILE_ID`. This command runs
before an interactive form, with a five second limit, and receives no plugin
host token. Only declared visible non-password fields are accepted. It must
only read configuration and must never print credentials. The form displays the effective values directly. CLI invocations skip this reader.

An optional `configuration_save_command` receives a JSON patch on stdin when
settings change. BMUX debounces edits, serializes writes and waits for saving
before Start or Cancel. Save errors stay in the form. This command has the same
profile, timeout and credential restrictions as the reader. Hidden fields and
passwords cannot be persisted. Text parameters can set `multiline: true`.

Authenticated plugin browser operations carry the plugin's own identity. The
external CLI identity requirements apply to external agents; plugin capability,
document and automation checks still apply to each browser operation.

Plugin setup uses the same rows, text size and controls as Settings. Settings are directly editable in their rows, with saved values shown in the controls. There is no separate editing mode.

The page overlay has one Details and settings expander with a view selector. Stop
returns browsing actions to their configuration form. Starting from that form
is the only start step; completed runs offer Choose session settings.

Invalid manifest edits preserve the last valid definition until corrected or the
app restarts. Invalid new plugins appear disabled with an error. Enabled scripts
are trusted across updates; bmux does not verify their signatures or contents.

`BMUX_CONFIG` determines the config and plugin directory. With `BMUX_DATA_DIR`,
the default is that data directory's config and plugins, never personal plugins.

## Manifest

```yaml
schema_version: 1
id: local.example
name: Example
version: 1.0.0
actions:
  - id: run
    title: Run example
    description: Optional explanation
    group: Browsing
    command: [python3, ./run.py]
    capabilities: [browser.read, browser.write, ui]
    timeout_seconds: 120
    parameters:
      - name: mode
        title: Mode
        kind: choice
        choices: [brief, detailed]
        required: true
proxy_providers:
  - id: example
    title: Example proxy
    help: Enter the service credentials supplied by the provider.
    authenticated: true
    regions:
      - { group: Europe, label: Amsterdam, protocol: https, host: proxy.example.com, port: 443 }
hooks:
  - id: page
    title: Prepare page
    event: page-ready
    matches: ["https://example.com/*"]
    command: [sh, ./page.sh]
    capabilities: [browser.write]
```

Proxy providers are declarative presets for the profile and Proxy connection
forms. A provider supplies its regions, endpoints, protocol, port, and whether
credentials are required; core bmux still stores credentials and manages the
connection. Providers appear only while their plugin is enabled. The bundled
`bmux.nordvpn` plugin is disabled by default and adds NordVPN regions when
enabled in the Plugins panel.

Commands are argument arrays, not interpolated shell strings. Paths beginning
with `.` resolve against the plugin directory; executable names use PATH. Invoke
`sh` explicitly for shell scripts. Install required interpreters yourself. Node.js
is required by the bmux host CLI, including packaged apps.

Parameters support `text`, `password`, `boolean`, and `choice`. Interactive runs
collect missing parameters with bmux prompts. CLI runs must supply required values
through `--parameters` (use this only for nonsensitive values). Scripts retrieve
parameters from the private `context` host call, not environment variables.

Hooks require both `enabled: true` and `hooks: true` in config. `startup` runs once
when enabled or when bmux starts; ordinary reloads do not repeat it. `page-ready`
runs at main-document DOM readiness. `url-change` runs on same-document navigation
(including History API changes). Page hooks require `matches`: anchored,
case-sensitive URL globs where `*` matches any substring. An optional `profiles`
list filters by profile **ID**. Hooks cannot collect parameters or open prompts,
activate clients, or change selection through the host API.

At most four scripts run concurrently. Manual actions have queue priority. Pending
hooks are coalesced by plugin, hook, and page, and cancelled when their document is
superseded. The queue holds up to 256 invocations; excess hooks are dropped. The
default timeout is 120 seconds; manifests may choose 1–3600 seconds. Timeouts,
cancellation, disablement, and shutdown revoke the invocation and terminate its
process group. Scripts must not detach their own daemon processes. Persistent
service supervision is not supported.

## Host calls

bmux supplies `BMUX_CLI`, `BMUX_PLUGIN_SOCKET`, `BMUX_PLUGIN_RUN_ID`, and
`BMUX_PLUGIN_TOKEN`. Keep invocation credentials private. All host calls use the
same JSON envelope as the normal CLI: `{ "ok": true, "result": ... }` or an error
with a nonzero exit code. Host calls never start or reconnect to another bmux
instance if their invocation has ended.

```sh
"$BMUX_CLI" plugin host context
"$BMUX_CLI" plugin host dom
"$BMUX_CLI" plugin host eval '{"expression":"document.title"}'
"$BMUX_CLI" plugin host progress '{"percent":50,"message":"Working"}'
"$BMUX_CLI" plugin host result '{"updated":true}'
```

Use `plugin host METHOD --stdin` with JSON on stdin for sensitive or structured
arguments. Do not place secrets in command arguments. For example, Python scripts
can use `subprocess.run([os.environ['BMUX_CLI'], 'plugin', 'host', method, '--stdin'],
input=json.dumps(arguments), capture_output=True, text=True, check=True)` and decode
`stdout`. See the page-tools `host.py` helper.

| Methods | Capability | Arguments and behavior |
| --- | --- | --- |
| `context` | None | Returns invocation IDs, parameters, URL, document ID, and whether its original client is currently interactive. `{ "refresh": true }` explicitly reacquires the same page's document. |
| `progress`, `result` | None | Explicit public output; never include secrets. Progress takes `percent` and `message`; result takes a JSON object. |
| `dom` | `browser.read` | `{ "html": true }` for HTML; otherwise visible text. Returns the page target, URL, and content. |
| `screenshot` | `browser.read` | Absolute `output` path for a PNG file. With `fullPage: false`, capture the current surface; `encoding: "base64"` returns `data` and `format` without a file. Viewport options: `format: "png"` or `"jpeg"`, JPEG `quality` (0–100), and `maxDimension` (1–16384 pixels, preserves aspect ratio). |
| `wait` | `browser.read` | `selector` and optional `timeout` (maximum 60000 ms). `expression` waits additionally require `browser.write`. |
| `eval` | `browser.write` | `expression` evaluated in the page's main JavaScript context, including DOM access; returns JSON-compatible value. |
| `click`, `type`, `fill` | `browser.write` | Main-document selectors. Click calls the element's DOM click method; type inserts `text` into an input/textarea selection. Fill replaces values using `fields: [{selector, value}]` and requires the current `origin`. Visible editable fields only. Input/change events are dispatched. |
| `key`, `navigate`, `back`, `forward`, `reload` | `browser.write` | Existing browser arguments without a target override. Navigation starts immediately. |
| `cdp` | `browser.cdp` | `method` and `params`; page-scoped DOM, Runtime, Page, Input, Network, CSS, Accessibility, Emulation domains. No target/session routing. Raw CDP is an advanced trusted capability; use `fill` for document-bound credentials. |
| `script.install` | `browser.cdp` | `source` and `worldName`; installs a page interaction helper in an isolated world in the original document. Like userscripts, installation leaves human input available and does not report agent activity. |
| `ui` | `ui` | `kind`, `title`, optional `required`. Kinds: `text`, `password`, `confirm`, `pick`. Pickers take `items: [{id,label,description?}]` and return the selected ID. Confirm returns a boolean; text/password return strings. |

Site automation actions can call `automation.acquire` with a matching HTTPS
`url` before browsing. The lease is bound to the invocation's profile and pane,
and is released when the invocation ends. `automation.status` reports group
usage, including weekly follow counts and limits. `automation.like` reserves one
like for a verified site post URL after
the user has set a positive `likesPerDay` cap. `automation.follow` reserves one
follow attempt before clicking a profile button, subject to the `followsPerWeek`
cap (10 by default, configurable from 0 to 10). These calls work only when an
automation group covers the profile and site. If `requiredPlugins` names a
plugin for the site, only that plugin ID may acquire its lease.

All plugin browser operations also use the default global [bot protection](agent.md#bot-settings),
including direct evaluation and raw CDP. It spaces social-site commands, bounds
automation sessions, and pauses a profile on known account warnings or challenges.
A safety failure terminates the plugin invocation and reports the pause reason.
The profile view's Bot tab controls the guard for that profile or individual pane. Configured
group leases and budgets remain separate and continue to apply when it is disabled.

`browser.manage` allows `profile.list`, `list-sessions/windows/panes`,
`new-window`, `split-window`, `select-pane/window`,
and `activate-client`, with the normal CLI RPC argument names and explicit IDs.
No other runtime methods are exposed by the plugin host.

Browser calls use the invocation's captured page, never a subsequently selected
pane. DOM operations reject after URL/document changes until the plugin
explicitly calls `context` with `refresh: true`. Delayed fill/evaluation uses an
object handle in the captured page execution context, which navigation destroys.
Waits and script processes do not occupy the browser's per-page command queue.

Prompts are scoped to the initiating client and selection. Escape, closing the
prompt, or changing that selection cancels pending interaction. Background scripts
cannot summon an overlay. After an explicitly requested external app interaction,
a plugin can wait for `context.interactive` before requesting the next prompt.

Subprocess stdout/stderr are discarded. Only explicit progress and results are
published; invocation tokens, parameters, host requests, and prompt responses are
not logged or persisted. Recent run history is bounded and lives in memory. A
plugin author can still disclose data through explicit results, DOM changes, or
external tools, so this contract is not a sandbox. Filled page values remain
accessible to the site and to bmux's existing trusted local automation API.

## CLI and authoring examples

```sh
bmux plugin list
bmux plugin run local.page-tools/title -t PANE_ID
bmux plugin run local.page-tools/annotate -t PANE_ID --parameters '{"note":"Review this page"}'
bmux plugin runs
bmux plugin cancel RUN_ID
bmux plugin reload
```

Run returns `{ "id": "..." }` immediately. Poll `plugin runs` for completion.
In the on-screen command prompt, `plugin run ID/ACTION` uses the current page and
may collect parameters; CLI invocations have no interactive client. Shortcuts use
`plugin:ID/ACTION`, and remain valid configuration even while a plugin is missing.

`local.page-tools` demonstrates a shell title query, a Python heading picker,
parameter collection, and an opt-in page hook scoped to local fixture paths.

Test plugins in a disposable `BMUX_DATA_DIR` with local fixture pages. Never copy
a personal browser profile into a test. Use explicit progress messages for safe
diagnostics; raw command output is intentionally not surfaced by bmux.

## Bundled browser tools

Saved forms are bundled actions. The `browser.forms`
capability and browser userscript settings are described in [Built-in plugins](browser-tools.md).
Use the plugin panel to enable or disable individual plugins; hooks remain a
separate opt-in in config. Bundled IDs take precedence over local plugin folders.

## Bookmark contributions

A plugin can declare a `bookmark` contribution independently of actions and
hooks. Enable the plugin in the Plugins panel, then attach it through a matching
bookmark's sliders. Global hooks need not be enabled. The bundled
`bmux.reddit-search` plugin provides Reddit post search filtering. The bundled
`bmux.x-search` plugin filters connection prompts in X and Twitter search
bookmarks. Both start disabled.

```yaml
bookmark:
  matches: ['https://example.com/search*']
  script: ./filter.js
  controls:
    - { name: minimum, title: Minimum score, kind: number, default: 2, min: 0, step: 1 }
    - { name: duplicates, title: Remove duplicates, kind: boolean, default: true }
```

Controls support `number`, `boolean`, `text`, and `choice`. Each requires a
`default`; choice controls require `choices`. Number controls optionally declare
`min`, `max`, and `step`. Matches use the same anchored URL globs as hooks. The
JavaScript file must be inside the plugin directory and at most 256 KiB.

The file contains a JavaScript function expression receiving validated settings
and returning a synchronous cleanup function. An optional second argument reports
hidden posts to the floating page overview. Call it after filtering with an array
of `{ key, title, url, reasons }` objects; `reasons` is an array of short strings.
Keep post keys stable, retain matches removed by infinite scrolling, and report
an empty array on cleanup or when the search changes. Reporting stays in the
page's isolated world.

```js
(settings) => {
  let observer = new MutationObserver(() => { /* Update matching page content. */ })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  return () => { observer.disconnect(); /* Restore modifications. */ }
}
```

Bookmark scripts execute at DOM readiness in a separate isolated world in the
attached pane. They share its page DOM but receive no Node, bmux host API, or
Chrome extension APIs. Cleanup runs before settings updates and same-document
navigation; a replaced document destroys its world. Keep work short, use observers
for later content, and reverse all DOM changes during cleanup. Script installation
has a one-second execution bound. Trust plugin code before enabling it; manifest
commands retain the existing OS-user execution model.

The overlay is owned by bmux in a closed shadow root. Its isolated-world binding
only updates validated settings for an existing attachment on the current
bookmark and document. The website's main JavaScript world receives no binding.

`bookmark.open` accepts `profile`, `bookmark`, and the existing `session`/`client`
selection arguments. It opens the owning profile's parameterized bookmark in a
new window and binds its plugins before navigation. An optional `tab` replaces
that pane's page instead, requiring the bookmark and pane to share a profile. `bookmark.plugins.update`
accepts `profile`, `bookmark`, `id`, `enabled`, and `values`; use `remove: true`
with the IDs to remove an attachment. Saved settings are separate from URL
parameters and keyed by profile and bookmark ID.

## Google result navigation

In Extensions > Plugins, enable Google result navigation and its **Automatic hooks**
checkbox. Enabling the plugin alone does not install the keyboard handler.
Alternatively, merge this into your config:

```yaml
plugins:
  bmux.google-search: { enabled: true, hooks: true }
```

Reload an open Google search after enabling it. Up/Down selects the previous or
next result and scrolls its headline into view; Enter opens the selected link.
Navigation is also installed after Google changes the search URL without a full
page load, including URL updates that interrupt the initial installation. Loading
the keyboard helper leaves the page ready for immediate typing and navigation.
Escape clears the selection. Search fields, editing, modified keys, and click
mode retain their normal behavior. The plugin runs in an isolated page world
without page access to browser or Node APIs. Disabling prevents installation on
subsequent pages; reload an existing page to remove its installed handler.

The Plugins list has an enabled/disabled toggle beside each installed plugin. Toggle it directly from the list, or select the plugin name to open its settings.

## Social Media tools and browsing launch

Social plugins declare `category: Social Media` and use the platform name. Their
details show every contributed action, including statistics, research,
publication, scheduling and browsing when supported by the installed plugin.

Actions with multiple settings present one form. Optional fields can use their
saved settings. Parameters may declare `default` and `hidden`; hidden parameters
remain accepted by CLI calls without appearing in the form. Password defaults
are rejected and parameter values stay out of public run records.

`launch_url` on a manual action requires `browser.manage`. Pressing Start browsing
approves startup, creates a muted blank window using the selected pane's profile,
and binds the invocation to that new pane. The runner acquires its automation
lease before navigating to the platform. The form can select Auto continue or
Ask before each action. Cancelling the form creates no window. CLI invocations
keep their existing pane and explicit session behavior.


Overlay content may include up to two copy entries in copies with id, label,
and text. Each full text is limited to 300,000 characters, separately from the
32 KB display limit. BMUX retains these texts privately for the run; published
overlay state contains only IDs and labels. A trusted copy button writes that
run's selected text to the clipboard. overlay.update reports copyPayloads: true
when this is supported.

Close overlay hides the view without stopping the run. Show overlay in plugin
activity reopens its original pane. When a run ends, its overlay collapses once
to a completion header; it can be expanded to inspect the last post or used to
choose a new session. Stop still returns directly to the configuration form.

Text parameters can declare `range: { min: 1, max: 120, step: 1, unit: s }` to show a two-handle slider. Values remain strings such as `8-12` (or `10` for a fixed value), including saved settings and CLI arguments. Bounds and step are validated before execution. Slider edits use the same automatic save as other settings.

### Named configuration profiles

Actions can declare `configuration_profile_command` alongside the configuration
read and save commands. BMUX supplies `BMUX_PLUGIN_PROFILE_ID` and
`BMUX_PLUGIN_CONFIGURATION_VERSION=2` to all three commands. The read and profile
commands return `{values, profiles: {active, items: [{id, name}], templates?: [{id, name}]}}`.
The save command continues to receive a field patch on stdin. The profile command
receives `{action: "create" | "select" | "rename" | "delete", id?, name?, template?}`
on stdin. Profile switching flushes pending edits and refreshes the same form;
it never starts the action. Plugins own storage and scope their libraries to the
provided BMUX profile. Older hosts omit the version variable; plugins supporting
them should return the original flat settings object in that case.

Form sections are collapsible. An overlay button can set `setting` to the ID of
an editable overlay control to open Session settings and focus that control,
without submitting a browser action.

Named profiles have a compact selector and an Edit button. Creation, naming and
Persona fields appear in a separate editor. Back to browsing flushes edits.

An overlay can supply `error: {title, message, diagnostic?, controls?: string[]}`.
BMUX replaces post cards, metrics and details with the error and only the named
recovery buttons. A recovery button with `setting` opens its editable control
inside this view. Recovery IDs must refer to existing button controls.
