#!/usr/bin/env python3
"""Local ClawTab job: serialize repairs and run Codex with approval review."""

import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid


SOURCE_ROOT = Path(__file__).resolve().parents[1]
ROOT = Path("/Volumes/sam/oss/bmux/public")
SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string"},
        "failed_run_url": {"type": "string"},
        "fix_commit": {"type": "string"},
        "verification_urls": {"type": "array", "items": {"type": "string"}},
        "explanation": {"type": "string"},
    },
    "required": ["status", "failed_run_url", "fix_commit", "verification_urls", "explanation"],
    "additionalProperties": False,
}
RETRY_DELAYS = (30, 60)


def write_json(path, value):
    staged = path.with_suffix(".tmp")
    staged.write_text(json.dumps(value))
    staged.replace(path)


def read_result(path):
    result = json.loads(path.read_text())
    if not isinstance(result, dict) or set(result) != set(SCHEMA["required"]):
        raise ValueError("Codex returned an incomplete repair result")
    if any(not isinstance(result[key], str) for key in SCHEMA["required"] if key != "verification_urls"):
        raise ValueError("Codex returned an invalid repair result")
    if not isinstance(result["verification_urls"], list) or any(not isinstance(url, str) for url in result["verification_urls"]):
        raise ValueError("Codex returned invalid verification URLs")
    return result


def run_agent(smoke, commit, result_dir):
    spec = importlib.util.spec_from_file_location("trigger_ci_repair", SOURCE_ROOT / "scripts/trigger-ci-repair.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    prompt = (
        'Delivery smoke test only. Do not change files, run tests, commit, or push. '
        'Return JSON with status="ok", failed_run_url="", fix_commit="", '
        'verification_urls=[], explanation="bmux-ci-repair-delivery".'
        if smoke else module.repair_prompt(commit)
    )
    schema = result_dir / "schema.json"
    schema.write_text(json.dumps(SCHEMA))
    output = result_dir / "result.json"
    checkpoint = result_dir / "session.json"
    state = json.loads(checkpoint.read_text()) if checkpoint.exists() else {}
    session = str(uuid.UUID(state["session_id"])) if state.get("session_id") else None
    for attempt in range(len(RETRY_DELAYS) + 1):
        output.unlink(missing_ok=True)
        command = [
            "codex", "exec", "--approve-for-me", "--cd", str(ROOT.parent), "--json",
            "--output-schema", str(schema), "--output-last-message", str(output),
        ]
        if session:
            command.extend(["resume", session, prompt if smoke else (
                "Continue this interrupted CI repair from its existing work and verification. "
                "Check what was already committed or pushed before making changes. "
                "If your fix advanced main, finish checking its CI and report the actual outcome. "
                "Return the required JSON result."
            )])
        else:
            command.append(prompt)
        capacity = False
        with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as process:
            for line in process.stdout:
                print(line, end="", flush=True)
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    capacity |= "model is at capacity" in line.lower()
                    continue
                if not isinstance(event, dict):
                    continue
                if event.get("type") == "thread.started":
                    session = str(uuid.UUID(event["thread_id"]))
                    write_json(checkpoint, {"session_id": session})
                if event.get("type") in {"error", "turn.failed"}:
                    capacity |= "model is at capacity" in json.dumps(event).lower()
            code = process.wait()
        if code == 0:
            return read_result(output)
        if not capacity or attempt == len(RETRY_DELAYS):
            raise RuntimeError(f"Codex exited with status {code}; repair state retained in {result_dir}")
        delay = RETRY_DELAYS[attempt]
        print(f"Model at capacity; continuing the repair in {delay} seconds", flush=True)
        time.sleep(delay)


def main():
    os.umask(0o077)
    commit = os.environ.get("CLAWTAB_PARAM_COMMIT", "")
    smoke = os.environ.get("CLAWTAB_PARAM_SMOKE") == "true"
    worktrees = ROOT / ".worktrees"
    worktrees.mkdir(exist_ok=True)
    state_dir = worktrees / "ci-repair-state"
    state_dir.mkdir(exist_ok=True)
    last_repair = state_dir / "last.json"
    if not commit and not smoke and last_repair.exists():
        commit = json.loads(last_repair.read_text())["commit"]
    if not smoke and not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("commit must be a full Git SHA; no interrupted repair is available to restart")
    lock = worktrees / "ci-repair.lock"
    result = None
    try:
        lock.mkdir()
    except FileExistsError:
        raise RuntimeError("Another repair owns ci-repair.lock; no agent launched") from None
    try:
        directory = state_dir / ("smoke" if smoke else commit)
        directory.mkdir(exist_ok=True)
        if smoke:
            (directory / "session.json").unlink(missing_ok=True)
        if not smoke:
            subprocess.run(["git", "-C", str(ROOT), "fetch", "origin", "main"], check=True)
            current = subprocess.check_output([
                "git", "-C", str(ROOT), "rev-parse", "origin/main",
            ], text=True).strip()
            if current != commit and not (directory / "session.json").exists():
                result = {
                    "status": "skipped", "failed_run_url": "", "fix_commit": "", "verification_urls": [],
                    "explanation": "Main has advanced; the obsolete failure was skipped without launching an agent.",
                }
        if result is None:
            if not smoke:
                write_json(last_repair, {"commit": commit})
            result = run_agent(smoke, commit, directory)
    finally:
        lock.rmdir()
    # The trusted wrapper writes ClawTab's result outside the agent's workspace.
    Path(os.environ["CLAWTAB_RESULT_FILE"]).write_text(json.dumps(result))
    print(f"CI repair result: {result['status']}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"CI repair: {error}", file=sys.stderr)
        sys.exit(1)
