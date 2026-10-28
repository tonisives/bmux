# BMUX build and test workflow

Tests run in GitHub Actions. Do not run local unit, Electron, UI, package smoke,
or full test suites. The local GUI runner rejects test commands and cannot
start a separate test VM. BMUX_TEST_NATIVE does not bypass this rule.

## Merge and verify

1. Merge the implementation branch into main. The post-merge hook builds and
   packages through the shared macOS build queue, then signs/installs on the host.
2. Push main and wait for the Check workflow on that exact merged commit.
3. Check the final conclusion and report its run URL. A queued run, cancelled
   run or passing run on an older commit is not verification. Fix failures and
   push again before calling the change complete.

Check runs unit/type/lint checks and the full Electron suite on its disposable
macOS desktop. Browser UI work can request the visual check through
workflow_dispatch. Focused investigation uses workflow_dispatch with test_pattern;
see test-reliability.md. Portable-host changes also need Portable hosts.

Packaging on merge does not start tests or restart the running browser.
Worktree merges do not replace the installed application.

## Local worker

All finite local builds share the existing worker: four virtual CPUs, 8 GB RAM,
one active job, j4. Use the normal packaging target. The controller owns startup,
cancellation and idle shutdown. Check its status with:

```sh
pnpm vm:status
```

BUILDCTL selects the client executable; it defaults to ~/.agents/scripts/buildctl.
The old vm:setup, vm:start, vm:stop and vm:exec commands no longer create or manage
a BMUX VM. Existing bmux-tests disks are retained and unused by this runner.
Do not launch them alongside the worker. See ~/.agents/scripts/build-service.md.
