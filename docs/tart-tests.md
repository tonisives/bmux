# GUI tests in Tart

Local GUI tests run in the `bmux-tests` macOS VM. Its viewer is assigned to
AeroSpace workspace `bot`. Focus and pointer changes happen inside the guest.
The guest uses two CPUs, 6 GB of memory, and a fixed 1440 by 1000 display. The
CPU count limits how much host CPU the VM can consume while it is busy.

Tart is installed at `/Volumes/sam/apps/tart/tart.app`. Its VM disks, image cache,
and runner state live in `/Volumes/sam/tart`. The source repository stays here.

## Setup

On this Apple Silicon Mac, run:

```sh
pnpm vm:setup
pnpm vm:start
```

Setup installs the checksum-pinned Tart release, downloads Cirrus Labs' Tahoe
base image, and adds a Tart-only AeroSpace rule. It backs up the existing
AeroSpace configuration and preserves its other settings. The image download is
about 27 GB compressed. The base image supplies Node 24, pnpm, Command Line
Tools, an automatically logged-in desktop, and automation permissions.

The runner uses Tart's guest agent. No SSH password or host browser profile is
needed. Audio and clipboard sharing are disabled. The VM viewer may be hidden
without stopping tests. The runner stops the VM after the last queued test, so
the viewer closes automatically. Use `BMUX_TART_HEADLESS=1 pnpm vm:start` to start
without a viewer; this choice takes effect when starting a stopped VM.

## Run tests

```sh
pnpm test:electron
pnpm test:electron tests/command-search.electron.test.ts --grep 'command finder'
pnpm test:ui
pnpm debug:ui
pnpm test:package
```

These commands start the VM if needed, copy a snapshot of the current worktree
including uncommitted source edits, install locked dependencies in the guest,
and run the tests there. Git-ignored files, environment files, host dependencies,
and browser profiles are excluded. Each worktree has its own guest checkout;
the runner queues GUI tests across worktrees so they cannot steal each
other's focus. A newer pending request from the same worktree with identical
test arguments replaces an older pending request. Ad hoc `vm:exec`, start, and
stop operations use the same lock,
so they also wait for the active test. Tests continue to use temporary browser
data and configuration.

Test output, screenshots, and Playwright results are saved to `artifacts/tart/<run-time>/`.
Browser and plugin failures also save `native-focus.json` under `test-results/`,
with recent focus transitions, input delivery, and native view bounds. The trace
records IDs and event types without typed text or credentials.
The command returns the guest test's exit status. `debug:ui` keeps the isolated
guest browser open until you quit it inside the VM; it holds the test queue.

`pnpm check` runs locally without GUI windows. `pnpm package` builds the host app at `build/bmux.app` without restarting it.
Use `BMUX_OUTPUT_DIR="$HOME/workspace/_tools" pnpm package` for the local tools folder.
`pnpm test:package`, or `BMUX_TEST_PACKAGED=1 pnpm test:electron`, packages and
installs a separate copy inside the guest for testing.

## Manage the VM

```sh
pnpm vm:status
pnpm vm:exec /usr/bin/sw_vers
pnpm vm:stop
```

`vm:stop` waits for any running test to finish. VM launch diagnostics are stored
in `/Volumes/sam/tart/bmux-runner/bmux-tests.log`.
Do not interact with the guest desktop during tests that check keyboard focus.

`TART_HOME`, `BMUX_TART_BIN`, and `BMUX_TART_VM` override the storage location,
executable, and VM name. `BMUX_TART_CPUS` overrides the two-CPU limit,
`BMUX_TART_MEMORY` overrides the memory allocation in MiB (minimum 4096), and
`BMUX_TART_IMAGE` selects the initial image during setup. CPU and memory changes
take effect the next time the runner starts a stopped VM. The defaults keep this machine's
installation on `/Volumes/sam`.

GitHub Actions runs the native tests directly on its disposable macOS runner.
For a deliberately foreground test on another disposable Mac, set
`BMUX_TEST_NATIVE=1`. Do not use that override on the working desktop.

References: [Tart setup and images](https://tart.run/quick-start/),
[Tart guest agent](https://github.com/cirruslabs/tart-guest-agent).
