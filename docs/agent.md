# Browser automation

Local plugins can contribute actions and hooks. See [Plugin authoring](plugins.md) for
the manifest, private host API, and isolated testing workflow. `bmux plugin run`
returns a run ID; `bmux plugin runs` reports completion. Do not print invocation
credentials or send secrets through command arguments or explicit plugin results.

Use `bmux` for bmux pages. The existing c-cdp Chrome instance is separate.

## Start a bot session

Identify each agent with its tmux pane ID. Set this once in the agent's shell,
or pass `--agent-id "$TMUX_PANE"` to individual commands:

```sh
export BMUX_AGENT_ID="$TMUX_PANE"
```

The identifier stays attached to panes created or used by the agent and appears
in automation pause notices. Outside tmux, use a stable name of your own.

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

Panes are persistent by default. Global anti-bot protection is enabled for every
profile, including existing profiles. Additional automation policies may require
a lease before agent commands can access selected websites.

## Anti-bot protection

Open the profile view's **Anti-bot** tab to check protection, limits, and pauses,
or disable it for a profile or individual pane. Pane toggles override the profile
default. Changes are saved and take effect immediately.
The CLI and plugin browser API share the guard; site-specific plugins are not
needed for these defaults:

- At most 10 minutes per automation session, followed by a 20-minute break.
- At least 2 seconds between actions on social sites, shared across a profile's
  panes. This covers Instagram, Threads, Facebook, X, LinkedIn, Reddit, YouTube,
  TikTok, Bluesky, and Pinterest, including subdomains and common alternate hosts.
  Mouse and key releases are immediate to avoid holding inputs down.
- Known account warnings, visible verification challenges, and rate-limit pages
  stop further automation. Detection runs before each browser operation.

Human browser controls remain available. Session usage and warning pauses survive
restarts. A pause applies to the profile across websites. Resolve the warning on
the affected website manually, then use **Resume automation** in the Anti-bot
tab. The notice names the blocking website and provides links to affected
automation panes, including their agent identifiers. The gear at the far right
opens Anti-bot settings for an affected pane. Manual browsing never consumes
automation time or waits for a cooldown, including in the same profile.
Permission requests use the same notice bar with the requesting pane and
**Go to pane**, **Deny**, and **Allow** controls. Visiting or dismissing a request
leaves it pending; dismissed requests remain available in **Activity**.
**Exclude website** in a warning notice adds its hostname to this profile's
**Excluded websites** list. Add a hostname or URL in that list to turn off
anti-bot for that exact hostname: session limits, social-site pacing, and warning
checks are skipped. Other profiles and websites retain their protection.
Exclusions persist until you remove them. Older temporary rules show their
expiry and offer **Keep excluded** to make them permanent.
The Profile tabs have icons and titled sections. Anti-bot shows **Limits** first,
then **Protection** and **Excluded websites**. **Paused automation** appears only
when a warning, break, or safety error needs attention. Its action resumes after
a resolved warning or resets a session to end a break.
Session minutes, break minutes, and social site delay are editable for the
selected profile. Press Enter or leave the field to save. Changes apply
immediately and preserve existing usage. Existing config values remain the
defaults for profiles without overrides; editing one profile leaves others alone.
The alert's X dismisses
the current notice without changing checks or resuming automation. The CLI cannot resume a
warning pause or change these settings. Resuming does not clear session usage or
bypass a cooldown.

Reaching the session limit shows a UI alert with the retry time. Wait for that
time, or choose **Reset session** in the alert or the profile's **Anti-bot** tab
to start a fresh session. Resetting applies to all panes using that profile and
keeps account warnings and site exclusions. The CLI cannot reset a session.
Dismissal hides the current alert without resetting the session.

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
