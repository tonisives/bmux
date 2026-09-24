# Memory diagnostics

Memory options are in Settings > Memory and in `config.yaml`:

```yaml
memory:
  lazyRestore: true
  idleUnloadMinutes: 0
```

`lazyRestore` defaults to true. On launch, ordinary inactive windows stay unloaded until selected or addressed by an agent command. Windows in background profiles continue loading on launch. Changing this option takes effect on the next launch.

`idleUnloadMinutes` defaults to 0 (off). Choose 5, 15, 30, or 60 minutes in Settings to unload eligible hidden pages after inactivity. This is deliberately conservative: pages with detected scripts, forms, frames, storage, cookies, media, downloads, or active automation stay live. A page can still hold state that bmux cannot detect or restore; use this option only if reloading those pages is acceptable. Unloaded pages remain in the layout and wake on selection or agent access.

Use the page context menu's “Keep Page Loaded” toggle for a pane that must retain its in-memory state. Protected panes load on launch and are exempt from idle unloading. Agents can set the same persistent flag with `bmux pane keep-alive -t PANE --enabled`, or with the `pane.keep-alive` RPC and `{ "pane": "pane_id", "enabled": true }`. Use `--enabled=false` to clear it. Idle unloading restores navigation history and scroll position when Electron can recover them, but does not preserve arbitrary JavaScript state.

Each pane now owns exactly one page, and pane IDs address that page. Existing state files are upgraded on launch: the formerly active page stays in its pane; any additional hidden pages become separate windows in the same session. The original state is saved as `state.json.v1-backup`, and the migrated pane IDs persist immediately. Legacy `tab.*` RPC calls are accepted during migration, but they no longer create or select hidden pages inside a pane. New integrations should use pane IDs and `list-panes`.

Run `bmux memory` for a fresh JSON snapshot, or `bmux memory --history` to also
include up to 120 samples collected every 30 seconds since startup (about one
hour). RPC equivalents are `memory` and `memory` with `{ "history": true }`.
History stays in memory and clears when the app exits. Requests do not add to
history, so frequent polling cannot displace the periodic samples.

`current.processes` is sorted by working-set bytes, largest first. Each row has
its PID, creation time, type, associated WebContents, pane IDs, and profile IDs.
`current.panes` maps these to session and window IDs and reports whether
the page is visible, background-throttled, or has queued automation (`busy`).
`current.contents` includes browser UI and extension WebContents as well as page WebContents.
Main-frame and subframe processes are mapped where Electron exposes them.
Profiles list their associated processes and the sum of their working sets.
Use existing pane/session/profile list commands to resolve the stable IDs.

`deltaBytes` compares the current measurement with the previous periodic sample,
whose timestamp is `comparedTo`. A new process has a null delta; PID reuse is
detected using process creation time. The total delta includes process creation
and exit. Sustained growth in the same process with a stable page count warrants
investigation, but does not by itself prove a leak.

Each process is counted once in `totalWorkingSetBytes`. Panes sharing a renderer
list the same PID; do not count that process separately for each pane. Profile
totals can overlap if a process maps to more than one profile, and exclude
processes without mapped panes. Browser, GPU, utility, and unmapped processes are
still included in the overall total. Frame ownership is best effort during
navigation or process exit.

Electron reports working sets in kilobytes; the command converts them to bytes.
Working sets include shared resident pages. Their sum is not the same metric as
macOS Activity Monitor's memory footprint, especially with memory compression.
See Electron's [process metrics](https://www.electronjs.org/docs/latest/api/structures/process-metric)
and [memory information](https://www.electronjs.org/docs/latest/api/structures/memory-info).

Sampling does not execute page JavaScript, capture screenshots, focus windows,
change selection, or change throttling. Reports omit URLs, titles, page content,
and credentials. This feature measures memory; it does not unload pages.
