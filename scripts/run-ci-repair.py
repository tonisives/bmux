#!/usr/bin/env python3
"""Local ClawTab job: serialize repairs and run Codex with approval review."""

import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


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
    subprocess.run([
        "codex", "exec", "--approve-for-me", "--cd", str(ROOT.parent),
        "--output-schema", str(schema), "--output-last-message", str(output), prompt,
    ], check=True)
    return json.loads(output.read_text())


def main():
    commit = os.environ.get("CLAWTAB_PARAM_COMMIT", "")
    smoke = os.environ.get("CLAWTAB_PARAM_SMOKE") == "true"
    if not smoke and not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("commit must be a full Git SHA")
    worktrees = ROOT / ".worktrees"
    worktrees.mkdir(exist_ok=True)
    lock = worktrees / "ci-repair.lock"
    result = None
    try:
        lock.mkdir()
    except FileExistsError:
        raise RuntimeError("Another repair owns ci-repair.lock; no agent launched") from None
    try:
        if not smoke:
            subprocess.run(["git", "-C", str(ROOT), "fetch", "origin", "main"], check=True)
            current = subprocess.check_output([
                "git", "-C", str(ROOT), "rev-parse", "origin/main",
            ], text=True).strip()
            if current != commit:
                raise RuntimeError("Main has advanced; no agent launched")
        with tempfile.TemporaryDirectory(prefix="ci-repair-", dir=worktrees) as directory:
            result = run_agent(smoke, commit, Path(directory))
    finally:
        lock.rmdir()
    # The trusted wrapper writes ClawTab's result outside the agent's workspace.
    Path(os.environ["CLAWTAB_RESULT_FILE"]).write_text(json.dumps(result))
    print(f"CI repair result: {result['status']}")


if __name__ == "__main__":
    main()
