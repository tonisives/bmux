# Browser automation

Local plugins can contribute actions and hooks. See [Plugin authoring](plugins.md) for
the manifest, private host API, and isolated testing workflow. `bmux plugin run`
returns a run ID; `bmux plugin runs` reports completion. Do not print invocation
credentials or send secrets through command arguments or explicit plugin results.

Use `bmux` for bmux pages. The existing c-cdp Chrome instance is separate.
See [Agent identity and focus](agent-identity.md) for payloads, configuration,
identity errors, stored context, and terminal focus.

## Start a bot session

Browser commands require an agent ID by default, including raw RPC calls and
commands that open a URL in a new pane. Use any stable identifier for the agent;
it can come from a terminal, an editor, or another application. Set it in each
command shell, or pass `--agent-id ID`:

```sh
export BMUX_AGENT_ID='research-task-42'
export BMUX_AGENT_NAME='Research agent'
export BMUX_AGENT_PURPOSE='Compare browser features'
```

By default, only the ID is required. The name and browsing reason are optional. The agent
icon in an alert shows the agents that used that website. Each pane toolbar
shows an **Active agent** icon while commands run in that pane and for 60 seconds
after its last command, even when there are no alerts. Hover to identify the
agent, or click to inspect its live context and focus its terminal.

To disable the ID requirement, open the agent dialog's **Bot settings** and
turn off **Require agent ID**, or set `automation.agents.requireId: false` in
`config.yaml`. The setting reloads live.

### Agent types and focus commands

Define one or more agent types in `config.yaml`. Each type declares fields to
show in the dialog and an optional shell command for **Focus agent**:

```yaml
automation:
  agents:
    requireId: true
    requireType: true
    definitions:
      tmux:
        fields:
          sessionId: { label: Terminal session, type: session, required: true }
          windowId: { label: Terminal window, type: window, required: true }
          paneId: { label: Terminal pane, type: pane, required: true }
          clientTty: { label: Terminal client, type: text }
        focusCommand: /absolute/path/to/bmux/scripts/focus-tmux-agent.sh
```

Set **Bot settings > Require agent type** (or `requireType: true`) to require
a configured type for every browser command. Mark fields `required: true` to
reject commands missing that type's context. This example requires all three
terminal IDs. Other applications can define their own required fields.

BMUX remembers context by agent ID, including name and browsing reason. Supply
complete context on the first command; later commands with the same ID reuse it
across browser panes. New values replace the registered context. Saved pane
records restore known agent context when BMUX restarts. An unknown ID must supply
its own type and required data; it never inherits another agent's context.

Pass the type and its data using `--agent-type` and `--agent-data`, or
`BMUX_AGENT_TYPE` and `BMUX_AGENT_DATA`. For local tmux agents, let the CLI derive
the terminal context on every command:

```sh
export BMUX_AGENT_TYPE=tmux
bmux agent context
bmux dom -t '%3'
```

`--agent-data` / `BMUX_AGENT_DATA` contains only the type's field values; the
agent ID and type are separate. Raw RPC accepts all three in its JSON arguments:

```json
{
  "pane": "%3",
  "agentId": "research-task-42",
  "agentType": "tmux",
  "agentData": { "sessionId": "$1", "windowId": "@2", "paneId": "%42" }
}
```

Use the calling terminal's IDs from `bmux agent context` for tmux context.
Wrappers that invoke the CLI, such as `gscctl`, inherit the `BMUX_AGENT_*`
environment variables from their shell.

The CLI uses the calling process's tmux pane. Shared-daemon Codex commands use
their injected thread ID and the saved session name and directory label in the
terminal title. The shell's current directory may differ from the saved session
directory. The title must identify one saved thread and one tmux pane; the selected
tmux pane and inherited `TMUX_PANE` are not used as identity. It
rejects supplied terminal IDs that disagree with the caller. Codex agents in tmux
get this context automatically, with their thread ID as the default agent ID.
`bmux agent context` prints the resolved context without starting the browser.

These terminal IDs are separate from BMUX session, window and pane IDs. The CLI
refreshes them when the agent moves. Other applications can supply their own type and
field values. Undeclared fields are shown by name; `sessionId`, `windowId`, and
`paneId` get default labels.

Focus commands run when the user clicks **Focus agent**. BMUX passes data as
literal environment values: `BMUX_AGENT_ID`, `BMUX_AGENT_TYPE`, and
`BMUX_AGENT_DATA`; fields typed `session`, `window`, and `pane` become
`BMUX_AGENT_SESSION_ID`, `BMUX_AGENT_WINDOW_ID`, and `BMUX_AGENT_PANE_ID`.
Text fields use `BMUX_AGENT_FIELD_` plus their upper snake case name, such as
`BMUX_AGENT_FIELD_CLIENT_TTY`. Quote these variables in shell commands.

The supplied focus script verifies the recorded terminal origin before selecting
the tmux client, window and pane. For Codex it finds the same thread's current
terminal again; it refuses missing, ambiguous or recycled terminal contexts.
Legacy tmux agents must send a new CLI command to refresh their origin before
using this focus helper. The origin is stored separately from visible fields and
passed to focus commands as `BMUX_AGENT_ORIGIN` JSON.
On macOS it brings Alacritty forward through Hammerspoon's `hs` CLI. An optional
`terminalWindowId` text field focuses that exact native terminal window.
The command has a ten-second timeout. Configure commands locally; bots provide
context data through their calls.

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
bmux kill-session -t <session-id-or-name> --confirm
```

Panes are persistent by default. Global bot protection is enabled for every
profile, including existing profiles. Additional automation policies may require
a lease before agent commands can access selected websites.

## Bot settings

Open the profile view's **Bot** tab to check protection, limits, and pauses,
or disable it for a profile or individual pane. Pane toggles override the profile
default. A second tab bar separates **Protection**, **Appearance**, and **Timing**.
Appearance configures the pointer, including profile or custom cursor color,
animation durations, cursor hide time, and command-label duration.
Timing configures page unlock time and the action pause using a two-handle range
slider. **Fast** uses 0–200 ms, **Medium** uses 800–1,200 ms, and **Safe** uses
1,500–2,500 ms. Presets change only the action pause. Sliders also have exact
numeric inputs. These cursor and timing settings are shared across profiles;
press **Apply** to save and apply them immediately.
The CLI and plugin browser API share the guard; site-specific plugins are not
needed for these defaults:

- At most 10 minutes per website hostname in a profile, followed by a 20-minute
  break for that website. Other hostnames keep their own timers. Panes using the
  same website and profile share its timer. A limit alert appears when an
  automation command reaches the limit; idle pages do not raise alerts. A full
  break without commands starts a fresh session on the next command.
- At least 2 seconds between actions on each social-site hostname within a
  profile. Panes on the same hostname and profile share the delay across windows
  and sessions; other hostnames and profiles have independent pacing. This covers
  Instagram, Threads, Facebook, X, LinkedIn, Reddit, YouTube,
  TikTok, Bluesky, and Pinterest, including subdomains and common alternate hosts.
  Mouse movement and input releases are immediate.
- Page actions share a domain lock across panes in the same profile, plus a lock
  for each pane. Clicks, scrolls, typing, keys, navigation, and scripts finish with a
  random 0.8–1.2 second pause before the next action can run. `www` and bare
  hostnames share the domain lock. Unrelated domains in different panes proceed
  independently, as do separate profiles. This also applies with bot protection or mouse
  simulation off; longer social-site delays still apply. DOM reads, waits, and screenshots do not take
  the action lock. Raw mouse and keyboard presses retain it until release;
  releases reach the page immediately.
- Agent scroll commands and CDP wheel events move the page smoothly and finish
  scrolling before the action pause starts. Reduced motion uses immediate
  scrolling. Modified wheel events keep their normal zoom or shortcut behavior.
- Reading page content through CLI or plugins gives the page a subtle blue pulse
  during the read and for 2.4 seconds afterward. Reduced motion uses a steady
  highlight. Read commands do not show or refresh the agent cursor.
- Each pane shows recent agent commands at the bottom for five seconds. Labels
  summarize the operation, such as `scroll down 500 px` or `click (120, 80)`;
  typed text and script contents stay out of the overlay.
- A pink wedge cursor appears on pointer actions, scrolling, and automated navigation.
  Every pane keeps its own cursor, including background panes.
  It tilts while idle, leaves a brief pink trail while moving, and shows a large
  pink halo on clicks. It hides after 20
  seconds without pointer or navigation activity. **Hide agent cursor** in Agent
  information keeps it hidden for that pane until **Show agent cursor** is chosen.
  Agent activity locks human mouse and keyboard input to that page; a lock badge
  appears over the pane and in its toolbar. Input unlocks after commands finish
  and 20 seconds pass without activity. Browser controls and shortcuts remain
  available. Hiding the agent cursor does not release the input lock. The agent
  sends browser input events without moving the system mouse cursor.
  Before each click it follows a varied curve with small deviations,
  changing speed and timing, and lands exactly on the target.
  **Simulate mouse movement** in Bot > Limits toggles this for the profile.
  It defaults on independently of bot protection, including profiles or panes
  with protection off, excluded websites, files, and local addresses.
  Rotation and pulses stop when the system requests reduced motion.
- Known account warnings, visible verification challenges, and rate-limit pages
  stop further automation. Detection runs before each browser operation.

Human browser controls remain available. Session usage and warning pauses survive
restarts. Account warning pauses apply to the profile across websites. Session limits apply only to their recorded website. Resolve the warning on
the affected website manually. After manual navigation or input, bmux rechecks the
loaded website and clears its saved warning when it is resolved. **Resume automation**
in the alert or Bot tab also checks immediately. Session breaks remain independent.
The notice shows its pause icon and detection time on the left, names the blocking
website once, and provides links to affected
automation panes, including their agent identifiers. The **Bot settings** row below the alerts holds the shared controls. Its gear
opens shared agent requirements and a **Profile limits** list. Every profile is
editable, including profiles with no open panes. Limits apply across agents using
that profile, with a separate session timer for each website. Nested settings use
the top-left back chevron or Escape to return to the previous view. Manual browsing never consumes
automation time or waits for a cooldown, including in the same profile.
Permission requests use the same notice bar with the requesting pane and
**Go to pane**, **Deny**, and **Allow** controls. Visiting or dismissing a request
leaves it pending; dismissed requests remain available in **Activity**.
Session alerts name websites used by admitted automation commands and committed
navigations, even if a pane later navigates elsewhere manually. Denied commands
do not add panes or websites. Old profile-wide timers start fresh per website; existing account warning pauses
are preserved.
The alert's **Disable Bot protection** dropdown shows the recorded website hostname and offers
**For 15 minutes**, **For 1 hour**, and **Until removed**. Its exclusion appears
in this profile's **Excluded websites** list. The Protection tab shows a compact
count; **Show all** expands the editor in place, and **Show less** collapses it.
Long lists scroll within the section and have a hostname search field.
Add a hostname or URL there to turn off
bot protection for that exact hostname: session limits, social-site pacing, and warning
checks are skipped. Other profiles and websites retain their protection.
Exclusions persist until you remove them. Older temporary rules show their
expiry and offer **Keep excluded** to make them permanent.
The Profile tabs have icons and titled sections. Bot shows **Enable Bot protection**
with profile and pane switches and their On/Off states, then **Limits** and
**Excluded websites**. **Paused automation** appears above those sections only
when a warning, break, or safety error needs attention. Its action resumes after
a resolved warning or resets a session to end a break. It lists paused websites
across the profile, including websites in other panes or closed tabs.
Session minutes, break minutes, and social site delay are editable for the
selected profile. Press Enter or leave the field to save. Changes apply
immediately and preserve existing usage. Existing config values remain the
defaults for profiles without overrides; editing one profile leaves others alone.
The shared collapse button moves agent alerts into the status bar. **Show agent alerts**
restores them without changing checks or resuming automation. The CLI cannot resume a
warning pause or change these settings. Resuming does not clear session usage or
bypass a cooldown.

Reaching the session limit shows a UI alert with the retry time. Wait for that
time, or choose **Reset session** in the alert's website dropdown to end that website's break.
**Reset all bot sessions** in the general row ends cooldowns across every profile.
The profile's **Bot** tab lists each paused website with its own **Reset session**
control. **Reset profile sessions** stays available there after alerts are collapsed
or expire. Reset sessions begin timing with their next admitted automation command
or committed navigation. All resets keep account warnings and site exclusions. The CLI cannot reset a session.

```sh
bmux automation safety
```

Optional config overrides preserve existing automation groups:

```yaml
automation:
  safety:
    enabled: true
    maxSessionMinutes: 10
    cooldownMinutes: 20
    socialDelayMs: 2000
    simulateMouseMovement: true
    profiles:
      profile_default: false
```

These are conservative local limits, not platform-approved quotas. Warning
detection is best effort and currently recognizes common English warning text
and challenge URLs. It does not solve challenges or guarantee that an account
will avoid restrictions. Trusted page scripts and external programs are not
sandboxed by this guard; it bounds subsequent bmux browser commands.

## Automation policies

Additional policies are optional and apply to the profile IDs and website hosts listed in
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
The X and LinkedIn plugins are optional and are not included in bmux.app. Copy
either folder from `optional-plugins/` in the source checkout to
`~/.config/bmux/plugins/` before enabling it. Each folder works independently;
see [Plugin installation](plugins.md#install-and-enable) if you use a custom
config location.

The plugins accept `urls` as a JSON array string and `topic` as a
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
