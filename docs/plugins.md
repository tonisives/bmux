# bmux script plugins

Plugins are local folders containing `plugin.yaml` and scripts in any language.
They can contribute actions, automatic hooks, browser operations, and transient
prompts. Scripts run as your OS user. Enable only code you trust: host capabilities
describe and restrict the host API, but do not sandbox filesystem, network, or
other programs the script can access. Pages retain Chromium's sandbox and receive
no Node integration or privileged preload.

## Install and enable

Copy or symlink a plugin folder under `plugins/` beside the active config file,
normally `~/.config/bmux/plugins/`. Examples live in `examples/plugins/` in the
checkout and `bmux.app/Contents/Resources/plugins/` in packaged builds. There is
no automatic download or execution of bundled examples.

Merge these entries into your existing config (preserve your keyboard edits):

```yaml
keyboard:
  shortcuts:
    Cmd+Shift+L: plugin:experimental.bitwarden/fill
  prefixBindings:
    P: plugins
plugins:
  local.page-tools:
    enabled: true
    hooks: false
  experimental.bitwarden:
    enabled: false
```

Open `plugins` in the command prompt to search and run actions. `activity` shows
progress, failures, and cancellation controls. Manifests and config reload live;
scripts are read on the next invocation. `plugin reload` rescans immediately.
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
    command: [python3, ./run.py]
    capabilities: [browser.read, browser.write, ui]
    timeout_seconds: 120
    parameters:
      - name: mode
        title: Mode
        kind: choice
        choices: [brief, detailed]
        required: true
hooks:
  - id: page
    title: Prepare page
    event: page-ready
    matches: ["https://example.com/*"]
    command: [sh, ./page.sh]
    capabilities: [browser.write]
```

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
hooks are coalesced by plugin, hook, and tab, and cancelled when their document is
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
| `context` | None | Returns invocation IDs, parameters, URL, document ID, and whether its original client is currently interactive. `{ "refresh": true }` explicitly reacquires the same tab's document. |
| `progress`, `result` | None | Explicit public output; never include secrets. Progress takes `percent` and `message`; result takes a JSON object. |
| `dom` | `browser.read` | `{ "html": true }` for HTML; otherwise visible text. Returns tab, URL, content. |
| `screenshot` | `browser.read` | Existing screenshot options, including absolute `output` path. |
| `wait` | `browser.read` | `selector` and optional `timeout` (maximum 60000 ms). `expression` waits additionally require `browser.write`. |
| `eval` | `browser.write` | `expression` evaluated in the page's main JavaScript context, including DOM access; returns JSON-compatible value. |
| `click`, `type`, `fill` | `browser.write` | Main-document selectors. Click calls the element's DOM click method; type inserts `text` into an input/textarea selection. Fill replaces values using `fields: [{selector, value}]` and requires the current `origin`. Visible editable fields only. Input/change events are dispatched. |
| `key`, `navigate`, `back`, `forward`, `reload` | `browser.write` | Existing browser arguments without a tab override. Navigation starts immediately. |
| `cdp` | `browser.cdp` | `method` and `params`; tab-scoped DOM, Runtime, Page, Input, Network, CSS, Accessibility, Emulation domains. No target/session routing. Raw CDP is an advanced trusted capability; use `fill` for document-bound credentials. |
| `ui` | `ui` | `kind`, `title`, optional `required`. Kinds: `text`, `password`, `confirm`, `pick`. Pickers take `items: [{id,label,description?}]` and return the selected ID. Confirm returns a boolean; text/password return strings. |

`browser.manage` allows `tab.list/create/close/select`, `profile.list`,
`list-sessions/windows/panes`, `new-window`, `split-window`, `select-pane/window`,
and `activate-client`, with the normal CLI RPC argument names and explicit IDs.
No other runtime methods are exposed by the plugin host.

Browser calls default to the invocation's captured tab, never the subsequently
selected tab. DOM operations reject after URL/document changes until the plugin
explicitly calls `context` with `refresh: true`. Delayed fill/evaluation uses an
object handle in the captured page execution context, which navigation destroys.
Waits and script processes do not occupy the browser's per-tab command queue.

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
bmux plugin run local.page-tools/title -t TAB_ID
bmux plugin run local.page-tools/annotate -t TAB_ID --parameters '{"note":"Review this page"}'
bmux plugin runs
bmux plugin cancel RUN_ID
bmux plugin reload
```

Run returns `{ "id": "..." }` immediately. Poll `plugin runs` for completion.
In the on-screen command prompt, `plugin run ID/ACTION` uses the current tab and
may collect parameters; CLI invocations have no interactive client. Shortcuts use
`plugin:ID/ACTION`, and remain valid configuration even while a plugin is missing.

`local.page-tools` demonstrates a shell title query, a Python heading picker,
parameter collection, and an opt-in page hook scoped to local fixture paths.
Bitwarden's [experimental plugin](../examples/plugins/experimental.bitwarden/README.md)
demonstrates native desktop communication using the same host API.

Test plugins in a disposable `BMUX_DATA_DIR` with local fixture pages. Never copy
a personal browser profile into a test. Use explicit progress messages for safe
diagnostics; raw command output is intentionally not surfaced by bmux.

## Bundled browser tools

Saved forms are bundled actions. The `browser.forms`
capability and browser userscript settings are described in [Browser tools](browser-tools.md).
Use the plugin panel to enable or disable individual plugins; hooks remain a
separate opt-in in config. Bundled IDs take precedence over local plugin folders.
