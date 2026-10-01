# Focused test verification

Keep local verification to typecheck, lint, and unit tests for the changed feature.
Run affected GUI tests in GitHub Actions or Tart. The full suite runs on main in
CI; it does not need to run on the working desktop for every edit.

## Select the affected behavior

Search existing assertions when changing a control, label, selection rule, or
shared test helper. Include its existing callers and relevant states, such as
blank and loaded panes. A newly added test alone may miss an existing route.

For example, changes to pane profile controls affect profile selection, opening
settings, and proxy settings. A useful pattern is:

```sh
gh workflow run check.yml -R tonisives/bmux --ref YOUR_BRANCH \
  -f test_pattern='profile icon|pane address shows profile|saved proxy settings|proxy toggle|profile proxy settings|blank pane can change profile|new sessions use the saved preference'
```

For a reproduced timing failure, repeat just its affected cases four to eight
times with `-F repeat_each=8`. Repetitions expose failures; they do not retry a
failed assertion or turn a failing run green.

## Verify the commit being merged

Commit and push the implementation branch before dispatching. Incorporate main
before the final verification if main changed behavior covered by these tests.
Wait for the selected run to finish:

```sh
gh run list -R tonisives/bmux --workflow Check --branch YOUR_BRANCH
gh run watch RUN_ID -R tonisives/bmux --exit-status
gh run view RUN_ID -R tonisives/bmux --json headSha,conclusion,url
git rev-parse HEAD
```

The tested SHA must match the implementation commit being merged. Record the run
URL and selected tests in the task result. A queued run, a run on an earlier
commit, or a green Portable hosts run does not verify the macOS GUI cases.

## Diagnose a failure

Check the first failed action and download `electron-test-results`. Profile and
command tests save native focus and mouse delivery records on failure. For their
DOM action traces, dispatch the affected cases with `-F trace=true`; failed traces
are saved as `trace.zip`. Tracing is off by default because recording snapshots
adds work and can change the timing of a race. Confirm a timing fix with tracing
off.

Wait for observable readiness: the intended pane is selected, a newly mounted
control has finished taking focus, navigation has committed, or a native view is
attached. Avoid fixed sleeps, forced DOM clicks, and blanket timeout increases.
Keep test-owned state and cleanup independent of preceding tests.

## Findings from the September 30 profile regression

`f2ddc6a` moved profile controls from the status bar into pane address bars.
Opening settings in a blank pane then required a picker with an autofocus select.
While a blank pane initializes, its profile control can change from the settings
route to the profile picker route. The helper chose between those routes using an
immediate label count, before clicking. The failed snapshot still showed the picker
and URL prompt, with no settings dialog. A trace also showed the chosen button
label disappearing before the click. The same case failed in several later main runs.
An isolated CI repetition reproduced it five times out of eight, so earlier tests
were not required to trigger the failure.

The helper now matches both labels, clicks once, and waits for the dialog or picker
that actually opened. It also waits for the picker's autofocus before clicking
settings. Assertions about the selected profile, saved proxies, and credentials
remain in place.

Earlier failures had different causes: shared recovery profile state, unbounded
Electron shutdown, and native window focus or remote signaling deadlines. Fixing
one case did not validate later changes to a different UI route. Keep verification
bound to the changed behavior and the exact commit.

## Remote ownership refresh

The subsequent Linux arm64 run found a viewer still displaying `Controlling`
after the host reported `CONTROL_EXPIRED` following a desktop takeover. A
periodic broadcast alone did not update the controls within the test deadline.
Viewers now request current state when they regain focus or become visible, and
after ownership errors. These are read-only refreshes; rejected input is not
retried. Local unit tests cover refresh, hidden views, listener cleanup, and
ownership errors. The existing Linux GUI case verifies the desktop takeover and
viewer reacquisition through the actual windows and data channel.

Repetition also exposed an attached viewer assertion running before signaling
finished: its video element already existed, but its state and controls did not.
That case now waits for the pane selector within the existing signaling deadline
and verifies a decoded video frame before checking control availability. Remote
test failures also retain native focus and input delivery diagnostics.

## Guarded reload and crash recovery

`662ac1a` enabled automation safety by default; `8697a7f` extended its accounting
to blank panes. The guard used the normal automation helper, which waits for an
initial navigation to finish. Consequently, CLI reload could not interrupt a
fixture with an unfinished load. Inspecting a crashed renderer also prevented
reload from reaching its recovery code. Both existing browser cases failed in
the full Check after the focused profile cases passed.

Reload and navigation inspect the current document without waiting for navigation.
Input and read commands still wait to inspect the loaded page for warnings.
Reload and navigation can recover a crashed renderer with no document to inspect;
the policy still checks persisted warnings, session limits, cooldowns, and pacing.
The warning test also checks that reload cannot bypass a latched warning.

Bound fixture CLI calls and diagnostic capture, and label steps that can wait on
renderer IPC. A dead renderer must produce a useful failure instead of consuming
the whole workflow deadline or hiding the original assertion during teardown.

Use asynchronous CLI calls when fixture HTTP servers run in the test worker.
Synchronous child processes block that server while commands wait for its page,
turning a valid navigation check into a deadlock. Create each test's artifact
directory independently. When multiple devices are enrolled, revoke the intended
viewer by its fingerprint; database row order does not identify it. Retain the
Electron child process at launch for fixtures that exercise disconnections, so
cleanup can still wait for or kill it after Playwright disposes its dispatcher.
