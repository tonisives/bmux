import copy
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
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
    result = {"status": "ok", "failed_run_url": "", "fix_commit": "", "verification_urls": [], "explanation": "verified"}
    session = "11111111-1111-4111-8111-111111111111"

    def process(self, events, code):
        process = MagicMock()
        process.__enter__.return_value = process
        process.stdout = io.StringIO("\n".join(json.dumps(event) for event in events) + "\n")
        process.wait.return_value = code
        return process

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
            result = root / "result.json"
            with patch.object(runner, "ROOT", root), patch.dict(os.environ, {"CLAWTAB_PARAM_SMOKE": "false", "CLAWTAB_PARAM_COMMIT": "a" * 40, "CLAWTAB_RESULT_FILE": str(result)}), patch.object(runner.subprocess, "run"), patch.object(runner.subprocess, "check_output", return_value="b" * 40), patch.object(runner, "run_agent") as launch:
                runner.main()
                launch.assert_not_called()
                self.assertFalse((root / ".worktrees/ci-repair.lock").exists())
                self.assertEqual(json.loads(result.read_text())["status"], "skipped")

    def test_failed_agent_releases_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(runner, "ROOT", root), patch.dict(os.environ, {"CLAWTAB_PARAM_SMOKE": "true"}), patch.object(runner, "run_agent", side_effect=RuntimeError("launch failed")):
                with self.assertRaisesRegex(RuntimeError, "launch failed"):
                    runner.main()
                self.assertFalse((root / ".worktrees/ci-repair.lock").exists())

    def test_capacity_resumes_the_exact_session_with_approval_review(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            commands = []
            def launch(command, **kwargs):
                commands.append(command)
                if len(commands) == 1:
                    return self.process([
                        {"type": "thread.started", "thread_id": self.session},
                        {"type": "turn.failed", "error": {"message": "Selected model is at capacity. Please try a different model."}},
                    ], 1)
                (root / "result.json").write_text(json.dumps(self.result))
                return self.process([{"type": "thread.started", "thread_id": self.session}], 0)
            with patch.object(runner.subprocess, "Popen", side_effect=launch), patch.object(runner.time, "sleep") as sleep:
                self.assertEqual(runner.run_agent(False, "a" * 40, root), self.result)
            self.assertNotIn("resume", commands[0])
            self.assertEqual(commands[1][-3:-1], ["resume", self.session])
            self.assertIn("--approve-for-me", commands[1])
            self.assertIn("--output-schema", commands[1])
            self.assertNotIn("--last", commands[1])
            self.assertNotIn("--model", commands[1])
            sleep.assert_called_once_with(30)
            self.assertEqual(json.loads((root / "session.json").read_text()), {"session_id": self.session})

    def test_capacity_retries_are_bounded_and_keep_the_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            events = [{"type": "thread.started", "thread_id": self.session}, {"type": "error", "message": "Selected model is at capacity."}]
            with patch.object(runner.subprocess, "Popen", side_effect=[self.process(events, 1) for _ in range(3)]) as launch, patch.object(runner.time, "sleep") as sleep:
                with self.assertRaisesRegex(RuntimeError, "repair state retained"):
                    runner.run_agent(False, "a" * 40, root)
            self.assertEqual(launch.call_count, 3)
            self.assertEqual([call.args[0] for call in sleep.call_args_list], [30, 60])
            self.assertTrue((root / "session.json").exists())

    def test_other_errors_are_not_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            process = self.process([{"type": "error", "message": "Automatic approval review rejected the action"}], 1)
            with patch.object(runner.subprocess, "Popen", return_value=process) as launch, patch.object(runner.time, "sleep") as sleep:
                with self.assertRaisesRegex(RuntimeError, "Codex exited with status 1"):
                    runner.run_agent(False, "a" * 40, Path(directory))
            launch.assert_called_once()
            sleep.assert_not_called()

    def test_restart_uses_the_retained_session_and_discards_partial_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "session.json").write_text(json.dumps({"session_id": self.session}))
            (root / "result.json").write_text("partial output")
            def launch(command, **kwargs):
                self.assertEqual(command[-3:-1], ["resume", self.session])
                self.assertFalse((root / "result.json").exists())
                (root / "result.json").write_text(json.dumps(self.result))
                return self.process([], 0)
            with patch.object(runner.subprocess, "Popen", side_effect=launch):
                self.assertEqual(runner.run_agent(False, "a" * 40, root), self.result)

    def test_restart_without_parameters_recovers_the_interrupted_commit_after_its_push(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / ".worktrees/ci-repair-state"
            session = state / ("a" * 40)
            session.mkdir(parents=True)
            (state / "last.json").write_text(json.dumps({"commit": "a" * 40}))
            (session / "session.json").write_text(json.dumps({"session_id": self.session}))
            output = root / "result.json"
            with patch.object(runner, "ROOT", root), patch.dict(os.environ, {"CLAWTAB_PARAM_SMOKE": "false", "CLAWTAB_PARAM_COMMIT": "", "CLAWTAB_RESULT_FILE": str(output)}), patch.object(runner.subprocess, "run"), patch.object(runner.subprocess, "check_output", return_value="b" * 40), patch.object(runner, "run_agent", return_value=self.result) as launch:
                runner.main()
            launch.assert_called_once_with(False, "a" * 40, session)
            self.assertEqual(json.loads(output.read_text()), self.result)
            self.assertFalse((root / ".worktrees/ci-repair.lock").exists())

    def test_manual_run_without_trigger_result_file_saves_its_completed_result(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(runner, "ROOT", root), patch.dict(os.environ, {"CLAWTAB_PARAM_SMOKE": "true"}, clear=True), patch.object(runner, "run_agent", return_value=self.result):
                runner.main()
            completed = root / ".worktrees/ci-repair-state/smoke/completed.json"
            self.assertEqual(json.loads(completed.read_text()), self.result)

    def test_completed_restart_delivers_the_saved_outcome_without_rerunning_an_agent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / ".worktrees/ci-repair-state"
            completed = state / ("a" * 40) / "completed.json"
            completed.parent.mkdir(parents=True)
            completed.write_text(json.dumps(self.result))
            (state / "last.json").write_text(json.dumps({"commit": "a" * 40}))
            output = root / "result.json"
            with patch.object(runner, "ROOT", root), patch.dict(os.environ, {"CLAWTAB_PARAM_SMOKE": "false", "CLAWTAB_PARAM_COMMIT": "", "CLAWTAB_RESULT_FILE": str(output)}), patch.object(runner.subprocess, "run") as fetch, patch.object(runner, "run_agent") as launch:
                runner.main()
            launch.assert_not_called()
            fetch.assert_not_called()
            self.assertEqual(json.loads(output.read_text()), self.result)


if __name__ == "__main__":
    unittest.main()
