# Automatic CI repair

`Repair CI failure` observes failed or timed-out main-branch push runs of Check,
Portable hosts, Windows, and Release. It calls the existing ClawTab trigger API
to start Codex on the configured Mac. Forks, pull requests, manual test runs, and
obsolete main commits cannot start a repair.

`CI repair hook test` is also allowlisted for an end-to-end test. Its temporary
`.github/workflows/ci-repair-hook-test.yml` fixture deliberately fails immediately;
the user-authorized repair is to delete that file and push the deletion. This is
the only exception to the agent's prohibition on removing tests to make CI pass.
The subscription can remain after the fixture is removed for future hook tests.

The local tmux shell job `bmux/ci-repair` runs `scripts/run-ci-repair.py` with
`codex exec --approve-for-me`. Automatic approval review applies to this job;
normal interactive sessions keep their existing settings. The wrapper collects
Codex's structured final response and writes the ClawTab result itself.
It retains the repair commit and Codex session under
`public/.worktrees/ci-repair-state`. Model-capacity errors resume that exact
session after 30 and 60 seconds, keeping approval review and the selected model.
Other errors stop the run and retain its checkpoint. `cwtctl jobs restart
bmux/ci-repair` continues the last repair without requiring its trigger parameters,
including when the interrupted agent already pushed its fix. A new request for
an obsolete commit is skipped before starting an agent.
The tmux backend is required on this Mac because daemon child processes cannot
read the workspace on `/Volumes/sam`.

Repository configuration:

- Actions secret `CLAWTAB_CI_REPAIR_TOKEN`: the dedicated `bmux-ci-repair` API token.
- Actions variable `CLAWTAB_CI_REPAIR_DEVICE_ID`: the local Mac's ClawTab machine ID.

The request uses the failing commit as its idempotency key, so multiple failures
and workflow reruns reuse the same agent request. The agent must acquire a local
repository lock (enforced by the wrapper), work in `.worktrees`, verify its change under AGENTS.md, and push
without force. Its final main commit must contain `[bmux-ci-repair]`. A failure
on that commit stops automatic repair until a human investigates or pushes a new
change. The repair agent reports structured results through ClawTab.

If the Mac is offline, the dispatch workflow fails. The existing trigger API does
not automatically retry `no_device` requests; replaying the same commit reuses that
terminal result. Inspect the trigger in ClawTab and start a manual repair once the
Mac is online. An interrupted agent may leave `public/.worktrees/ci-repair.lock`;
check that no repair is running before removing that directory.

Use the workflow's manual dispatch with a failed run ID and `dry_run: true` to
check eligibility without launching an agent. Dry runs retain all eligibility
checks. To pause automatic repairs, disable the workflow in GitHub Actions.
To remove access, revoke `bmux-ci-repair` in ClawTab and delete the Actions secret.

The job has no schedule and accepts `commit` (full SHA) or `smoke=true` as trigger
parameters. The smoke mode returns a test result without changing repository files.
The installed job uses macOS system Python, working directory
`/Volumes/sam/oss/bmux`, and no injected secrets. Its local `job.md` invokes:

```sh
CLAWTAB_PARAM_COMMIT={commit} CLAWTAB_PARAM_SMOKE={smoke} exec /usr/bin/python3 /Volumes/sam/oss/bmux/public/scripts/run-ci-repair.py
```

This command template accepts only trusted callers. GitHub supplies its validated
commit SHA; the API token already authorizes arbitrary agent and job requests.
Parameter defaults are `commit: ''` and `smoke: 'false'`.

Validate changes with:

```sh
python3 scripts/test-trigger-ci-repair.py
actionlint .github/workflows/ci-repair.yml
```
