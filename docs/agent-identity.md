# Agent identity and focus

BMUX identifies automation callers separately from the browser pane they control.
It shows their context in **Agent information** and can run a configured command
to focus their terminal or application.

## Identity payload

For a configured `tmux` type, an agent payload looks like this:

```json
{
  "agentId": "indexing-task",
  "agentType": "tmux",
  "agentData": {
    "sessionId": "$1",
    "windowId": "@2",
    "paneId": "%42"
  }
}
```

`agentId` is a stable caller ID. `agentType` selects a definition in
`automation.agents.definitions`. `agentData` holds that definition's field
values, all strings. Field names come from the config: a definition using
`pane_id` expects `pane_id`, not `paneId`. Optional `agentName` and
`agentPurpose` describe the caller and its browsing task.

Browser commands also have their own target, such as `pane: "%3"`. That BMUX
pane is separate from the terminal's `agentData.paneId`.

Pane IDs are globally unique; a window ID is unnecessary when targeting one.
Browser commands accept tmux-style targets:

```sh
bmux eval -t '%29' 'document.title'
bmux eval -t gp:6 'document.title'
bmux eval -t gp:6.0 'document.title'
```

`gp:6` uses the selected pane in window 6 of session `gp`, or its first pane
when no client selects one. `gp:6.0` explicitly uses its first pane; pane
indices start at zero. These commands do not change the client's selection.

## Sending it

| Payload field | CLI flag | Environment variable |
| --- | --- | --- |
| `agentId` | `--agent-id` | `BMUX_AGENT_ID` |
| `agentType` | `--agent-type` | `BMUX_AGENT_TYPE` |
| `agentData` | `--agent-data` | `BMUX_AGENT_DATA` |
| `agentName` | `--agent-name` | `BMUX_AGENT_NAME` |
| `agentPurpose` | `--agent-purpose` | `BMUX_AGENT_PURPOSE` |

Only `agentData` goes into `--agent-data` or `BMUX_AGENT_DATA`. Raw RPC takes
the full identity alongside the command arguments in one JSON object:

```sh
bmux rpc dom '{"pane":"%3","agentId":"indexing-task","agentType":"tmux","agentData":{"sessionId":"$1","windowId":"@2","paneId":"%42"}}'
```

Replace the example IDs with actual IDs. Explicit flags override RPC fields;
RPC fields override environment defaults.

Wrappers such as `gscctl` inherit these environment variables. In a regular
tmux shell, use:

```sh
BMUX_AGENT_ID=gscctl BMUX_AGENT_TYPE=tmux \
gscctl index https://clawjobs.cc/ai/guide/forward-deployed-engineer
```

The CLI derives the terminal IDs and origin on every browser command when the
type is `tmux`. It uses process ancestry to find the calling terminal. Codex
commands in tmux identify their terminal using their thread ID, session name,
and working directory; their thread ID is also the default agent ID. A regular
shell must opt in with `BMUX_AGENT_TYPE=tmux` or `--agent-type tmux`.

`bmux agent context` prints the resolved context without starting BMUX. It
prints JSON for inspection; it does not export variables or register an agent.
Automatic tmux context uses `sessionId`, `sessionName`, `windowId`, and `paneId`; custom field
names must be supplied explicitly. Supplied standard terminal IDs must agree
with the resolved caller. The popup shows `sessionName` in place of the session
ID; focus commands still receive the ID. Each CLI browser call refreshes the name.

## Config and errors

The defaults require an ID, allow an omitted type, and define no types. Configure
requirements and field names in `~/.config/bmux/config.yaml`:

```yaml
automation:
  agents:
    requireId: true
    requireType: true
    definitions:
      tmux:
        fields:
          sessionId: { label: Session, type: session, required: true }
          windowId: { label: Window, type: window, required: true }
          paneId: { label: Pane, type: pane, required: true }
          clientTty: { label: Terminal client, type: text }
        focusCommand: /absolute/path/to/bmux/scripts/focus-tmux-agent.sh
```

Config changes reload live. The Bot settings UI controls `requireId` and
`requireType`; definitions and focus commands live in the config file.
Required fields are checked whenever their type is supplied, even when
`requireType` is off. With `requireType` on, the type must be configured.

Missing identity or fields produce a compact error with JSON generated from
the current definitions:

```text
Agent ID required. Expected JSON: {"agentId":"<id>","agentType":"tmux","agentData":{"sessionId":"<session>","windowId":"<window>","paneId":"<pane>"}}
```

The example uses the supplied configured type, or the first configured type
and a list of alternatives. It includes required fields only. Placeholders
describe values to provide; they are not resolved terminal IDs. With no types
configured, an ID-only requirement shows `{"agentId":"<id>"}`.

## Stored context and focus

BMUX remembers accepted context by agent ID across browser panes. Later calls
with that ID can omit previously registered metadata. A new ID supplies its
own required context. New field maps replace old maps, so send the complete
`agentData` map when updating it. Changing identity clears the previous agent's
metadata; changing type clears its data and origin. Saved pane records restore
known context when BMUX restarts.

**Focus agent** runs the selected type's `focusCommand`. It receives
`BMUX_AGENT_ID`, `BMUX_AGENT_TYPE`, `BMUX_AGENT_DATA`, and `BMUX_AGENT_ORIGIN`.
An automation alert keeps its recorded agent as the focus target when another
agent later uses the same browser pane, including after a browser restart.
Fields typed `session`, `window`, or `pane` also become
`BMUX_AGENT_SESSION_ID`, `BMUX_AGENT_WINDOW_ID`, or `BMUX_AGENT_PANE_ID`.
Text fields become `BMUX_AGENT_FIELD_<UPPER_SNAKE_CASE_NAME>`.

Click **Agent controlling · input locked** on a page to open that pane's
**Agent information**, then click **Focus agent** to go to its terminal.
Page input stays locked during automation; browser controls remain available.

The tmux helper uses the recorded origin to verify the terminal before focusing
it. Origin is added by automatic CLI context and stored separately from visible
fields. Supplying just the three terminal IDs through raw RPC does not add a
verified origin. Send a browser command through the CLI with type `tmux` to
refresh it. Focus runs only when requested through the UI.

See [Browser automation](agent.md) for browser commands and protection settings.


## Cursor and timing

Open **Profile > Bot** and choose **Appearance** or **Timing**, or use a pane's
**Active agent** indicator, choose **Bot settings**, then
**Cursor and timing**. Appearance controls include color, size, idle rotation,
click halo, and movement trail. The Timing tab sets animation durations, cursor
hide time, command-label duration, page unlock time, and the minimum/maximum
pause between actions with a two-handle slider. Fast (0–200 ms), Medium
(800–1,200 ms), and Safe (1,500–2,500 ms) presets change only the action pause.
Sliders have exact numeric inputs as well. **Apply** saves the settings and updates
open panes live. **Reset defaults** restores the current tab's draft; choose
**Apply** to save it.

These settings also reload live from `~/.config/bmux/config.yaml`:

```yaml
agentFeedback:
  color: profile
  cursorSize: 24
  idleRotationDegrees: 12
  idleRotationMs: 3600
  haloSize: 64
  haloDurationMs: 1100
  trailWidth: 10
  trailFadeMs: 350
  cursorHideMs: 20000
  commandDisplayMs: 5000
  inputUnlockMs: 20000
  actionDelayMinMs: 800
  actionDelayMaxMs: 1200
```

Cursor color defaults to `profile`, using the same color as each pane’s profile
icon. Choose **Custom** to use a six-digit hex color across all profiles. Existing
custom colors are preserved. Sizes are pixels, rotation is degrees, and config
durations are milliseconds.
A zero cursor hide time keeps the cursor visible until manually hidden. Zero
rotation, halo size/duration, trail width/fade, or command duration disables that
effect. Page unlock time starts after commands finish; pending commands retain
the input lock even when the timeout is zero. Action pause limits may both be
zero. Social-site delays remain configurable in **Profile limits**.
