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
Their first access must create unloaded panes with normal navigation enabled;
creating a blank renderer first can prevent restored pages from waking correctly.
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

Linux native window tests need a desktop window manager as well as Xvfb. The test
image starts Openbox and waits for its readiness property before Playwright.
The browser test container permits up to 1 GiB of shared memory for Chromium's
multiple windows and live video surfaces; this is a limit, not reserved memory.
These resources are confined to CI test containers.

Exit diagnostics confirmed that viewer reloads could also terminate Electron with
`SIGSEGV`. Remote capture now uses one shared `capturePage` poller per pane at ten
frames per second, matching the transport's capture cadence. It avoids native
frame-subscription teardown and concurrent per-viewer capture loops. Unit tests
cover bounded concurrency, shared viewers, cleanup, failed captures, and stale
frames arriving after a reconnect. The Linux GUI repetitions continue to exercise
reload, signaling, native window handoff, and actual decoded frames.
Wait for decoded video dimensions after browser history navigation too: controls
can be ready while the video dimensions are still zero, making click coordinates
invalid. Assert finite coordinates before sending native pointer input.

For a native Linux crash, dispatch `portable.yml` with `-f native_crashes=true`.
The disposable runner enables core dumps and retains only GDB stack frames in
the failure artifact; core files are removed inside the container. This is off
by default and adds no debugger or GUI workload to the local machine. A passing
repetition followed by a crash on the same source needs a native stack, rather
than another unchanged run or a larger timeout.

Decoded Linux stacks identified `WebContents::IsFocused()` calling
`aura::Window::GetToplevelWindow()` on a missing native view. Electron 44.3.0's
global focus lookup enumerates the hidden offscreen transport too. Focus events
and even fixture shutdown could therefore crash the host. The transport now uses
a normal hidden window with background throttling disabled; its canvas streaming
does not require offscreen window rendering. The capture test queries global
native focus while the transport is active to exercise this regression directly.
Fixture shutdown also reports native crash signals instead of accepting them as
a successful close after the body assertions pass.

## Native window handoff

The October 1 x64 Portable hosts failure reached desktop takeover and lease
release, then failed waiting for the viewer's native window to regain focus.
The fixture requested focus once and only observed it afterward. The retained
diagnostic timed out, so it does not establish why that activation was lost.

The fixture now raises and requests focus for the intended window while it is
unfocused, and observes native acknowledgement on a later poll. Both handoffs
use the existing five-second assertion deadline. Desktop client selection,
lease release, page resizing, and viewer reacquisition remain separate assertions;
requesting fixture focus does not retry application input or ownership operations.
Verify this timing change with repeated Portable hosts runs on both architectures.

The first sixteen-repeat verification then found two x64 watch timeouts, before
the native handoff. Host capture could emit its offer while its promise was still
pending; an immediate answer could look up a stream that had not yet been
registered and be discarded. The host now holds that initial offer until
registration, and discards it if opening is canceled. Unit tests reproduce the premature offer on
the original implementation and check answer delivery and canceled opening.

A later 32-repeat ARM run reported a watch timeout after viewer reload while the
native process remained responsive. The relay's disconnect notification awaits
authorization; a replacement socket can register during that wait. The old
notification must recheck both the disconnected identity and its target before
sending, so it cannot tear down the replacement stream. Deferred-authorization
unit cases fail with the original notification loop and cover both replacement
viewers and replacement hosts. The Linux fixture retains transport offer and
connection states on failure without recording SDP, keys, or credentials.

The transport diagnostics then found a new host peer still gathering ICE
candidates after 25 seconds, with no offer published. Waiting for every TURN
route can therefore exhaust the watch deadline even when direct candidates are
available. New hosts and viewers exchange descriptions immediately and send
subsequent candidates through the signed signaling channel. Watch and connection
identities prevent late candidates or answers from reaching a replacement peer;
candidates arriving before its description are buffered. Older peers retain the
complete-description path. Unit cases cover pending gathering and compatibility,
and the Linux viewer flow suppresses the gathering-complete notification while
still requiring actual candidates, negotiated data channels, and decoded video.

## Bundled plugin completion

A later full main run found the bundled Python heading action still `running`
at the test's five-second completion deadline. Its fixture allowed unrelated
live filter downloads and compilation. Plugin fixtures now disable those updates,
like the other isolated GUI fixtures. The heading case records the prompt's run
ID, verifies that submission removes the picker, and checks that exact run and
its `scrolled` result. Post-prompt Python/CLI work has a separate fifteen-second
deadline; other plugin waits keep their existing deadlines. A missing submission
still fails at the picker assertion. Repeated verification includes the preceding
hide/reactivate and password prompt case, as well as heading completion.

## Tooltip fixture readiness

The subsequent Check on `7747eaa` found the tooltip hidden with no text after
hovering the first tab. The fixture launched five pages without waiting for them,
resized the native window, and changed status bar placement immediately before
hovering. The renderer's status attribute alone does not establish native page
bounds or a fresh mouseenter after those layout changes.

The fixture now waits for those pages and for native page bounds to match the
renderer at the requested window width. It moves the pointer to Help before
entering the tab, and observes tooltip dismissal before the next hover. The
existing text, native stacking, top/bottom placement, and long-title boundary
assertions keep their deadlines. Repeated CI includes the preceding constrained
tab-width case to exercise its retained pointer and window state.

Those repetitions still exposed disappearing or missing tooltips. The hovered
target was not the selected tab, while the strip's layout effect keeps the
selected tab in view. The fixture now explicitly selects each target and observes
its selection before hovering. Failures retain a bounded pointer/scroll timeline
before detaching the native window, so future failures can distinguish lost hover
from tooltip rendering or stacking.

## Bookmark page focus

Closing the bookmark picker can request page focus before the selected native
view has usable layout bounds. The old focus command fell back to the browser
controls and discarded the request; attaching the page afterward left Vim
scrolling disabled. Focus requests now retain the selected client and pane until
attachment, and a new UI focus request, overlay, or selection cancels them.

The bookmark regression checks mouse and Enter opening with native j/k input.
Its mobile case holds layout IPC while requesting focus, then verifies focus and
scrolling after attachment. It also requests UI focus before releasing layout to
check cancellation. The deferred-focus assertion fails on the original code.

## Split-pane navigation readiness

The full Check on `70bfa2d` then found the ad-blocking case calling `locator` on
an undefined page. Its split RPC returns before the new pane's navigation appears
in Playwright's page list; address controls can mount before that navigation.
The fixture now waits for the intended URL and completed document load before
reading it. It checks the fixture heading and the advertisement's presence too,
so a missing or incomplete document cannot satisfy a hidden-ad assertion. The
existing independent blocking and reload assertions remain in place.

## Interrupted userscript refresh

The October 2 Check on `863db90` reported the early script disabled with no
current page-tools error, but the next document still observed its original
`before-inline` value. A registration refresh discarded every installed script
identifier before sending Chromium the first removal command. If any removal
failed, remaining registrations became untracked; a successful later refresh
could clear the error while leaving those old scripts active.

Registration cleanup now removes each identifier from its list only after
Chromium acknowledges removal. A targeted unit test interrupts cleanup, disables
the script, refreshes again, and executes the installed main-world registrations
in a fresh document. It reproduces the stale value on the original implementation.
The GUI case also reenables and disables the modified script on distinct document
URLs, checking both the page's early observation and the script's global value.
Repeat the browser-tools file in CI to include settings, CSS, CSP, and profile
changes without running GUI tests on the local desktop or enabling retries.

## Independent live stylesheet refresh

The October 4 Check on `0227ea9` retained the old user CSS after a file edit.
Its failure diagnostics showed a page-tools refresh error, with valid script
files. The error did not identify the failed CDP stage. Refresh previously ran
registration, appearance, user CSS, and cosmetics in sequence: a failure before
user CSS prevented the edit from applying, and the unchanged file produced no
later watcher event to recover it.

These operations now settle independently within the existing per-tab refresh
queue. A registration or appearance failure still reports an error, including
the failed stage, while user CSS can update. No command is retried and no watcher
or test deadline is increased. Unit tests inject failures in registration and
isolated-world creation; both reproduce stale CSS on the prior implementation,
verify replacement on the new one, and check recovery without duplicate sheets.
Repeat the existing browser-tools GUI file to exercise automatic file watching,
script enable/disable, navigation, profile scoping, and strict CSP together.

The first file repetition passed the CSS assertion but exposed failed script
registration later in the same case. Eight repetitions of that case alone then
passed, so verification must retain its preceding settings and navigation cases.
Command diagnostics now report only a method and a fixed cause category, without
page URLs or script contents. Cleanup also accepts Chromium's specific
`Script not found` response as completed removal, while retaining ownership for
timeouts and other failures. Chromium's [browser-side removal](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/devtools/protocol/page_handler.cc)
erases its registration before forwarding to the renderer; the renderer can
report the entry absent. A unit test models that completed removal followed by
the missing-entry response and verifies disabled scripts stay absent.

Further repetition found an enabled script missing with no refresh error or
pending operation. An explicit refresh can be followed by a config/file watcher
refresh during the next navigation. Removing and reinstalling identical sources
creates an unnecessary interval without the document-start script. Each tab now
remembers successfully installed sources and preserves their registrations when
unchanged. Failed installation and debugger detachment invalidate that memory.
The unit coverage verifies no registration changes for CSS-only edits and
duplicate refreshes, plus registration after a new debugger session. Current
appearance and CSS still refresh independently. Fixture RPCs have labelled
15-second steps; opt-in tracing records unfinished operation names and durations
without their page data.

## Pointer fixture layout readiness

The concurrent October 4 Check on `88bad22` selected the upper-right pane but
recorded a cursor at the old full-height right pane's center. The pointer fixture
previously waited for the lower pane's document, then immediately sent shortcuts;
that did not establish that native view bounds matched the new split layout.
It now waits for all visible native page bounds to match the renderer after
splitting and zoom changes, and waits for the initial page focus handoff. Its
isolated configuration also disables unrelated live filter updates. Shortcut,
autorepeat, zoom, scroll, and background no-warp assertions remain in place.

## Floating address focus and the full-suite budget

The October 3 Check on `b84cd17` entered a second floating-pane URL before the
first submission finished returning native keyboard focus to the page. The
history test now clicks the address field before editing and waits for the native
page-focus handoff after navigation. Both tiled and floating cases passed 12
repetitions each on `85a587d`, and passed again in its full-suite run.

That full run hit the workflow's 12-minute limit after 139 passing tests and three
skips, without a failed assertion. The same suite had previously finished in
9.5 minutes; several tests were slower on this runner, including the real idle
unload wait. Check now allows 20 minutes for the serial GUI suite and 25 minutes
for the job. Individual test deadlines, one GUI worker, zero retries, and the
affected-tests-only local policy are unchanged. A suite timeout remains a failure
and retains diagnostics; the extra budget lets healthy tests finish on slower
hosted runners as the suite grows.

The next full branch run exposed two other fixture assumptions. At the scaled
iPhone home indicator, flooring the screenshot coordinate selected an
antialiased RGB 51 edge; the nearest pixel in the retained image was RGB 17.
Screenshot samples now round to the nearest physical pixel while retaining the
same dark-indicator and white-bar thresholds. The bookmark scrolling case waits
for a complete, scrollable document and the fixture background in a captured
native frame before sending its first key. Focus, scroll, and mobile reattachment
assertions remain in place; native key delivery is not retried.
Chromium can reject capture with `UnknownVizError` before that first frame is
available. The existing five-second readiness poll treats only that error as
not ready; other capture errors fail immediately.

The full run on `154f960` passed those GUI cases but failed an automation lease
check with an empty CLI response after 1.8 minutes. That fixture still used
`spawnSync` for expected-denial commands. A CLI readiness check can wait for the
page while the synchronous call blocks the Node event loop serving that page.
The fixture now awaits asynchronous CLI subprocesses with a 20-second process
deadline, preserves valid JSON denial replies, and reports actual process errors.
It also disables unrelated external filter updates. `AGENTS.md` records the
asynchronous-fixture rule; the local affected-tests-only policy is unchanged.
