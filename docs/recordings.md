# Activity hooks and recordings

Use **Record** in the status bar to capture the selected pane. **Clips** opens the
recording history with Stop, Play and Show files. These controls do not activate
another window or acquire remote browser control. Remote recordings occupy one
ordinary live view per pane and use the account's existing stream limits.

Video is saved under `/Volumes/sam/movies/bmux/observations/YYYY-MM-DD/EPISODE`
on this Mac. Other computers use `~/Movies/BMUX`. `record start --output` chooses
another absolute directory. Each pane has one continuous WebM video; FFmpeg, if
installed, also produces an H.264 MP4. Source WebM files remain available if
conversion fails. Recordings stop after 35 minutes, on request, on renderer
failure, or when their browsing episode ends. Interrupted recordings stay visible
in history after BMUX restarts. Reconnects appear as gaps in the video and in the
local recording manifest. The Mac must remain awake and connected.

```
bmux record start -t %29
bmux record list
bmux record stop RECORDING_ID
bmux record reveal RECORDING_ID
bmux record play RECORDING_ID
```

Page capture includes BMUX's in-page agent cursor. Plugins should use BMUX mouse
commands or `Input.dispatchMouseEvent` for clicks and wheel scrolling so their
actions are visible in recordings. Direct DOM clicks do not move that pointer.

## Hooks

Remote settings contains **Activity hooks**. Each owner can configure an HTTPS
webhook or a ClawTab device/job, select events, and filter by service, host,
session, pane, profile, or agent ID. A hook starts disabled. The editor accepts a
Bearer token and never returns its value. A blank token preserves the saved
credential. The relay needs `BMUX_HOOKS_ENCRYPTION_KEY`, a persistent base64 encoded
32-byte encryption key, before saving credentials. Keep it stable across relay
deployments. Public HTTPS destinations only; redirects are not followed and DNS
answers are validated and pinned for each delivery.

Events contain IDs, timestamps, method, outcome and duration. They exclude page
content, URLs, command arguments and screenshots. `agent.session.start` begins
an episode for a session and agent. `agent.action` records command completion.
`agent.session.end` follows 30 seconds of inactivity. Commands and plugins keep
the episode open until they finish. Several panes can belong to one episode.

Hosts journal events before sending them and retain unacknowledged events for
seven days, up to 20,000 events. The relay acknowledges committed events, creates
deliveries in the same transaction and deduplicates by event ID. Deliveries retry
for 24 hours. ClawTab requests retain their idempotency key across transport
failures and poll saved run IDs after a relay restart. A terminal failed run may
be dispatched again; the recording ID is the episode ID, so the local consumer
does not start a second recording. Ended episodes skip delayed recording starts.

```
bmux hooks list
bmux hooks create --file /path/to/hook.json
bmux hooks update HOOK_ID --stdin < /path/to/hook.json
bmux hooks enable HOOK_ID
bmux hooks deliveries HOOK_ID
bmux hooks test HOOK_ID
```

**Test delivery** queues a fixture event with `test: true`. The bundled recording
consumer checks connectivity and returns without opening a browser. Custom
webhook consumers should treat this as a test. Delivery history shows pending,
delivered, skipped and expired events. Tokens and response bodies stay out of
delivery errors.

## ClawTab recording consumer

`examples/clawtab/record-session/job.yaml` defines a short binary job invoking
`scripts/record-session.mjs`. Set its absolute paths for the receiving Mac and
install it in ClawTab as `bmux/record-session`. Configure a ClawTab hook with that
job slug, the Mac's device ID, and an API token. Subscribe to start and end;
`agent.action` is optional for other consumers. Filter by session or service to
choose which agents to observe. No clock schedule is needed.

The job sends the event to the running local BMUX process, which opens its own
viewer using the existing desktop login. The recorder verifies the host
generation and current episode before continuing, adds panes as they appear,
and stops when that episode ends. A delayed stop is idempotent and prevents a
later start for the same episode. Recording starts asynchronously, so the first
few seconds can be missed. The local BMUX process needs this version loaded;
packaging a new app does not replace a running app.

The relay stores hooks and delivery state even while the Mac is offline. It
cannot recover video from time spent offline. V1 saves locally and has no cloud
upload or calendar recording schedule.
