import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import os
import tempfile


spec = importlib.util.spec_from_file_location(
    "trigger_ci_repair", Path(__file__).with_name("trigger-ci-repair.py")
)
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)
runner_spec = importlib.util.spec_from_file_location(
    "run_ci_repair", Path(__file__).with_name("run-ci-repair.py")
)
runner = importlib.util.module_from_spec(runner_spec)
runner_spec.loader.exec_module(runner)


class RepairRequestTests(unittest.TestCase):
    def setUp(self):
        self.run = {
            "id": 123,
            "repository": {"full_name": "tonisives/bmux"},
            "head_repository": {"full_name": "tonisives/bmux"},
            "head_branch": "main",
            "head_sha": "a" * 40,
            "event": "push",
            "status": "completed",
            "conclusion": "failure",
            "name": "Check",
        }

    def payload(self, run=None, sha=None, message="A normal change"):
        return repair.repair_request(
            run or self.run, sha or self.run["head_sha"], message, "local-mac"
        )

    def test_targets_mac_and_dedicated_job(self):
        payload, reason = self.payload()
        self.assertIsNone(reason)
        self.assertEqual(payload["device_id"], "local-mac")
        self.assertEqual(payload["job"], "bmux/ci-repair")
        self.assertEqual(payload["params"], {"commit": self.run["head_sha"]})
        self.assertFalse(payload["wait"])

    def test_fork_pr_and_other_events_are_rejected(self):
        changes = [
            {"head_repository": {"full_name": "fork/bmux"}},
            {"repository": {"full_name": "someone/bmux"}},
            {"event": "pull_request"},
            {"event": "workflow_dispatch"},
            {"head_branch": "feature"},
            {"status": "in_progress"},
            {"conclusion": "success"},
            {"conclusion": "cancelled"},
            {"name": "Repair CI failure"},
        ]
        for change in changes:
            with self.subTest(change=change):
                payload, reason = self.payload(self.run | change)
                self.assertIsNone(payload)
                self.assertIsNotNone(reason)

    def test_stale_commit_and_repair_commit_stop(self):
        self.assertIsNone(self.payload(sha="b" * 40)[0])
        self.assertIsNone(self.payload(message="Fix [bmux-ci-repair]")[0])

    def test_all_failures_for_one_commit_have_identical_requests(self):
        other = copy.deepcopy(self.run)
        other.update(id=456, name="Portable hosts", run_attempt=2)
        self.assertEqual(self.payload()[0], self.payload(other)[0])

    def test_timeout_is_eligible(self):
        self.assertIsNotNone(self.payload(self.run | {"conclusion": "timed_out"})[0])

    def test_live_hook_fixture_is_eligible_and_has_scoped_cleanup_permission(self):
        payload, reason = self.payload(self.run | {"name": "CI repair hook test"})
        self.assertIsNone(reason)
        self.assertIsNotNone(payload)
        prompt = repair.repair_prompt(self.run["head_sha"])
        self.assertIn(".github/workflows/ci-repair-hook-test.yml", prompt)
        self.assertIn("delete only that fixture workflow", prompt)


class LocalRunnerTests(unittest.TestCase):
    def test_existing_lock_prevents_launch_and_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = root / ".worktrees/ci-repair.lock"
            lock.mkdir(parents=True)
            with patch.object(runner, "ROOT", root), patch.dict(os.environ, {"CLAWTAB_PARAM_SMOKE": "true"}), patch.object(runner, "run_agent") as launch:
                with self.assertRaisesRegex(RuntimeError, "Another repair"):
                    runner.main()
                launch.assert_not_called()
                self.assertTrue(lock.is_dir())

    def test_stale_commit_prevents_launch_and_releases_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(runner, "ROOT", root), patch.dict(os.environ, {"CLAWTAB_PARAM_SMOKE": "false", "CLAWTAB_PARAM_COMMIT": "a" * 40}), patch.object(runner.subprocess, "run"), patch.object(runner.subprocess, "check_output", return_value="b" * 40), patch.object(runner, "run_agent") as launch:
                with self.assertRaisesRegex(RuntimeError, "Main has advanced"):
                    runner.main()
                launch.assert_not_called()
                self.assertFalse((root / ".worktrees/ci-repair.lock").exists())

    def test_failed_agent_releases_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(runner, "ROOT", root), patch.dict(os.environ, {"CLAWTAB_PARAM_SMOKE": "true"}), patch.object(runner, "run_agent", side_effect=RuntimeError("launch failed")):
                with self.assertRaisesRegex(RuntimeError, "launch failed"):
                    runner.main()
                self.assertFalse((root / ".worktrees/ci-repair.lock").exists())


if __name__ == "__main__":
    unittest.main()
