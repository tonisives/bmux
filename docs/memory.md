# Memory diagnostics

Run `bmux memory` for a fresh JSON snapshot, or `bmux memory --history` to also
include up to 120 samples collected every 30 seconds since startup (about one
hour). RPC equivalents are `memory` and `memory` with `{ "history": true }`.
History stays in memory and clears when the app exits. Requests do not add to
history, so frequent polling cannot displace the periodic samples.

`current.processes` is sorted by working-set bytes, largest first. Each row has
its PID, creation time, type, associated WebContents, tab IDs, and profile IDs.
`current.tabs` maps these to session, window, and pane IDs and reports whether
the page is visible, background-throttled, or has queued automation (`busy`).
`current.contents` includes browser UI and extension WebContents as well as tabs.
Main-frame and subframe processes are mapped where Electron exposes them.
Profiles list their associated processes and the sum of their working sets.
Use existing tab/session/profile list commands to resolve the stable IDs.

`deltaBytes` compares the current measurement with the previous periodic sample,
whose timestamp is `comparedTo`. A new process has a null delta; PID reuse is
detected using process creation time. The total delta includes process creation
and exit. Sustained growth in the same process with a stable page count warrants
investigation, but does not by itself prove a leak.

Each process is counted once in `totalWorkingSetBytes`. Tabs sharing a renderer
list the same PID; do not count that process separately for each tab. Profile
totals can overlap if a process maps to more than one profile, and exclude
processes without mapped tabs. Browser, GPU, utility, and unmapped processes are
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
