#!/usr/bin/env python3
"""Prepare Expo iOS sources remotely and start their Xcode Cloud archive."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "scripts/mobile-cloud.json"
WORKFLOW = "mobile-cloud-prepare.yml"


def run(*args, cwd=ROOT, capture=True):
    result = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE if capture else None)
    if result.returncode:
        raise RuntimeError(f"{args[0]} {args[1]} failed (exit {result.returncode})")
    return result.stdout.strip() if capture else None


def api(*args):
    return json.loads(run("asc", *args, "--output", "json"))


def validate_workflow(workflow, config):
    attrs = workflow["attributes"]
    if not attrs.get("isEnabled"):
        raise RuntimeError("Enable the Mobile TestFlight workflow in Xcode Cloud first.")
    expected = f'{config["app_dir"]}/ios/{config["scheme"]}.xcworkspace'
    if attrs.get("containerFilePath") != expected:
        raise RuntimeError(f"Xcode Cloud must use workspace {expected}.")
    archives = [a for a in attrs.get("actions", []) if a.get("actionType") == "ARCHIVE"]
    if not any(a.get("platform") == "IOS" and a.get("scheme") == config["scheme"]
               and a.get("buildDistributionAudience") in ("APP_STORE_ELIGIBLE", "INTERNAL_ONLY")
               for a in archives):
        raise RuntimeError("Configure an iOS Archive action with TestFlight deployment preparation first.")
    if any(attrs.get(key) for key in ("branchStartCondition", "tagStartCondition", "pullRequestStartCondition", "scheduledStartCondition")):
        raise RuntimeError("Use manual start conditions for Mobile TestFlight to avoid duplicate paid builds.")


def resolve_workflow(config):
    apps = api("apps", "list", "--bundle-id", config["bundle_id"])["data"]
    if len(apps) != 1:
        raise RuntimeError(f'Expected one App Store Connect app for {config["bundle_id"]}.')
    app_id = apps[0]["id"]
    workflows = api("xcode-cloud", "workflows", "list", "--app", app_id, "--paginate")["data"]
    matches = [w for w in workflows if w["attributes"]["name"] == config["workflow"]]
    if len(matches) != 1:
        raise RuntimeError(f'Enroll this app in Xcode Cloud and create workflow "{config["workflow"]}"; see docs/mobile-cloud.md.')
    workflow = api("xcode-cloud", "workflows", "view", "--id", matches[0]["id"])["data"]
    validate_workflow(workflow, config)
    return app_id, workflow["id"]


def published_source(ref):
    if not ref:
        if run("git", "status", "--porcelain", "--untracked-files=normal"):
            raise RuntimeError("Commit and push changes before a cloud build, or select a published MOBILE_CLOUD_REF explicitly.")
        ref = run("git", "branch", "--show-current")
        if not ref:
            raise RuntimeError("Select MOBILE_CLOUD_REF when HEAD is detached.")
        sha = run("git", "rev-parse", "HEAD")
    else:
        sha = None
    # Resolve on GitHub rather than trusting a possibly stale local origin ref.
    remote = json.loads(run("gh", "api", f'repos/{json.loads(CONFIG.read_text())["repository"]}/commits/{ref}'))["sha"]
    if sha and sha != remote:
        raise RuntimeError(f"Push {ref} first: its GitHub commit differs from the local checkout.")
    return remote


def prepare(config, sha):
    request_id = uuid.uuid4().hex
    branch = f"xcode-cloud/ios-{request_id}"
    run("gh", "workflow", "run", WORKFLOW, "--repo", config["repository"],
        "--ref", config["dispatch_branch"], "-f", f"source_sha={sha}", "-f", f"request_id={request_id}")
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        runs = json.loads(run("gh", "run", "list", "--repo", config["repository"], "--workflow", WORKFLOW,
                              "--event", "workflow_dispatch", "--limit", "100", "--json", "databaseId,displayTitle,url"))
        matches = [r for r in runs if r["displayTitle"] == f"Prepare iOS {request_id}"]
        if matches:
            job = matches[0]
            print(f'Preparing native project: {job["url"]}', flush=True)
            run("gh", "run", "watch", str(job["databaseId"]), "--repo", config["repository"], "--exit-status", capture=False)
            with tempfile.TemporaryDirectory(prefix="mobile-cloud-") as directory:
                run("gh", "run", "download", str(job["databaseId"]), "--repo", config["repository"],
                    "--name", "mobile-cloud-receipt", "--dir", directory)
                receipt = json.loads((Path(directory) / "receipt.json").read_text())
            if receipt["source_sha"] != sha or receipt["branch"] != branch:
                raise RuntimeError("Native preparation receipt does not match this request.")
            current = json.loads(run("gh", "api", f'repos/{config["repository"]}/commits/{branch}'))["sha"]
            if current != receipt["prepared_sha"]:
                raise RuntimeError("Prepared branch changed after native generation.")
            return receipt
        time.sleep(3)
    raise RuntimeError(f"Preparation dispatch was accepted but its run could not be located. Check GitHub Actions for request {request_id} before retrying.")


def source_commit(data):
    return data.get("attributes", {}).get("sourceCommit", {}).get("commitSha")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default=os.environ.get("MOBILE_CLOUD_REF") or None)
    parser.add_argument("--prepare-only", action="store_true", help="Generate the enrollment branch without starting an Apple build")
    parser.add_argument("--wait", action="store_true", help="Wait for the Apple archive and verify its uploaded build")
    args = parser.parse_args()
    config = json.loads(CONFIG.read_text())
    sha = published_source(args.ref)
    app_id, workflow_id = (None, None) if args.prepare_only else resolve_workflow(config)
    receipt = prepare(config, sha)
    print(f'Native project branch: {receipt["branch"]}\nSource commit: {sha}', flush=True)
    if args.prepare_only:
        print("Use this branch to enroll the app in Xcode Cloud; see docs/mobile-cloud.md.")
        return
    started = api("xcode-cloud", "run", "--workflow-id", workflow_id, "--branch", receipt["branch"])
    run_id = started["buildRunId"]
    print(f'Xcode Cloud run: {run_id}\nTestFlight: https://appstoreconnect.apple.com/apps/{app_id}/testflight/ios', flush=True)
    build = json.loads(run("asc", "api", "GET", f"/v1/ciBuildRuns/{run_id}"))["data"]
    if source_commit(build) and source_commit(build) != receipt["prepared_sha"]:
        raise RuntimeError(f"Run {run_id} selected a different commit; inspect it before retrying.")
    print(f"Monitor: asc xcode-cloud status --run-id {run_id} --wait", flush=True)
    if args.wait:
        run("asc", "xcode-cloud", "status", "--run-id", run_id, "--wait", "--poll-interval", "30s", "--timeout", "2h", capture=False)
        # An archive finishing is separate from App Store Connect accepting its upload.
        deadline = time.monotonic() + 1800
        while time.monotonic() < deadline:
            result = json.loads(run("asc", "api", "GET", f"/v1/ciBuildRuns/{run_id}", "--query", "include=builds"))
            data = result["data"]
            if source_commit(data) != receipt["prepared_sha"]:
                raise RuntimeError(f"Run {run_id} did not build the prepared commit.")
            if data["attributes"].get("completionStatus") != "SUCCEEDED":
                raise RuntimeError(f"Xcode Cloud run {run_id} did not succeed.")
            builds = [b for b in result.get("included", []) if b["type"] == "builds"]
            if any(b["attributes"].get("processingState") in ("FAILED", "INVALID") for b in builds):
                raise RuntimeError("App Store Connect rejected the uploaded build; inspect TestFlight processing.")
            if builds and all(b["attributes"].get("processingState") == "VALID" for b in builds):
                print("TestFlight upload processed successfully: " + ", ".join(b["id"] for b in builds))
                return
            time.sleep(30)
        raise RuntimeError("Archive succeeded, but TestFlight processing is still pending. Inspect the reported run before retrying.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, KeyError, ValueError, FileNotFoundError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
