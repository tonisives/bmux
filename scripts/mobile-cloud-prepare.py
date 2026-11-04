#!/usr/bin/env python3
"""Generate an Expo native project on a disposable GitHub runner."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def run(*args, cwd=ROOT):
    subprocess.run(args, cwd=cwd, check=True)


def main():
    config = json.loads((ROOT / "scripts/mobile-cloud.json").read_text())
    request = os.environ["REQUEST_ID"]
    source = os.environ["SOURCE_SHA"]
    if not re.fullmatch(r"[0-9a-f]{32}", request) or not re.fullmatch(r"[0-9a-f]{40}", source):
        raise SystemExit("Expected a request UUID and full source commit SHA.")
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if actual != source:
        raise SystemExit("Checkout does not match the requested source commit.")
    app = ROOT / config["app_dir"]
    run("pnpm", "install", "--frozen-lockfile", "--child-concurrency=4", cwd=app)
    run("pnpm", "exec", "expo", "prebuild", "--platform", "ios", "--no-install", cwd=app)
    ios = app / "ios"
    project = ios / f'{config["scheme"]}.xcodeproj'
    if not project.is_dir():
        raise SystemExit(f"Expected generated Xcode project {project}.")
    workspace = ios / f'{config["scheme"]}.xcworkspace'
    workspace.mkdir(exist_ok=True)
    (workspace / "contents.xcworkspacedata").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<Workspace version="1.0">\n'
        f'  <FileRef location="group:{project.name}"></FileRef>\n'
        '  <FileRef location="group:Pods/Pods.xcodeproj"></FileRef>\n</Workspace>\n')
    shutil.copytree(app / "ci_scripts", ios / "ci_scripts", dirs_exist_ok=True)
    # Prebuild's installed Expo template must never pin the Linux runner's Node path.
    (ios / ".xcode.env.local").unlink(missing_ok=True)
    branch = f"xcode-cloud/ios-{request}"
    run("git", "checkout", "-b", branch)
    run("git", "add", "--force", "--", str(ios.relative_to(ROOT)))
    run("git", "commit", "-m", f"Prepare iOS cloud sources from {source}")
    prepared = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    run("git", "push", "origin", f"HEAD:refs/heads/{branch}")
    receipt = {"source_sha": source, "prepared_sha": prepared, "branch": branch}
    (ROOT / "receipt.json").write_text(json.dumps(receipt) + "\n")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write(f"Native iOS project ready on `{branch}`.\n\nSource: `{source}`\n\nPrepared: `{prepared}`\n")


if __name__ == "__main__":
    main()
