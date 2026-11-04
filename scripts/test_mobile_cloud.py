import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("mobile_cloud", Path(__file__).with_name("mobile-cloud.py"))
cloud = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloud)


class CloudCommandTest(unittest.TestCase):
    config = {"app_dir": "mobile", "scheme": "Example"}

    def workflow(self):
        return {"attributes": {
            "isEnabled": True,
            "containerFilePath": "mobile/ios/Example.xcworkspace",
            "actions": [{"actionType": "ARCHIVE", "platform": "IOS", "scheme": "Example",
                         "buildDistributionAudience": "APP_STORE_ELIGIBLE"}],
        }}

    def test_archive_upload_is_required(self):
        workflow = self.workflow()
        cloud.validate_workflow(workflow, self.config)
        del workflow["attributes"]["actions"][0]["buildDistributionAudience"]
        with self.assertRaisesRegex(RuntimeError, "TestFlight"):
            cloud.validate_workflow(workflow, self.config)

    def test_wrong_workspace_is_rejected(self):
        workflow = self.workflow()
        workflow["attributes"]["containerFilePath"] = "Other.xcodeproj"
        with self.assertRaisesRegex(RuntimeError, "workspace"):
            cloud.validate_workflow(workflow, self.config)

    def test_push_triggers_cannot_duplicate_manual_builds(self):
        workflow = self.workflow()
        workflow["attributes"]["branchStartCondition"] = {"source": {"isAllMatch": True}}
        with self.assertRaisesRegex(RuntimeError, "manual start"):
            cloud.validate_workflow(workflow, self.config)

    def test_disabled_workflow_is_rejected(self):
        workflow = self.workflow()
        workflow["attributes"]["isEnabled"] = False
        with self.assertRaisesRegex(RuntimeError, "Enable"):
            cloud.validate_workflow(workflow, self.config)

    def test_internal_testflight_archive_is_accepted(self):
        workflow = self.workflow()
        workflow["attributes"]["actions"][0]["buildDistributionAudience"] = "INTERNAL_ONLY"
        cloud.validate_workflow(workflow, self.config)

    @patch.object(cloud, "run", return_value=" M mobile/app.json")
    def test_dirty_checkout_stops_before_remote_dispatch(self, command):
        with self.assertRaisesRegex(RuntimeError, "Commit and push"):
            cloud.published_source(None)
        self.assertEqual(command.call_count, 1)

    @patch.object(cloud, "run")
    @patch.object(cloud, "api", return_value={"buildRunId": "apple-run"})
    @patch.object(cloud, "prepare", return_value={"branch": "xcode-cloud/ios-request", "prepared_sha": "prepared"})
    @patch.object(cloud, "resolve_workflow", return_value=("app", "workflow"))
    @patch.object(cloud, "published_source", return_value="source")
    def test_cli_run_receipt_is_used_and_commit_verified(self, source, workflow, prepare, api, command):
        command.return_value = json.dumps({"data": {"attributes": {"sourceCommit": {"commitSha": "prepared"}}}})
        with patch.object(cloud.sys, "argv", ["mobile-cloud.py"]), patch("sys.stdout", new_callable=io.StringIO) as out:
            cloud.main()
        self.assertIn("apple-run", out.getvalue())
        command.assert_called_once_with("asc", "api", "GET", "/v1/ciBuildRuns/apple-run")

    @patch.object(cloud, "run", return_value='{"data":{"attributes":{"sourceCommit":{"commitSha":"wrong"}}}}')
    @patch.object(cloud, "api", return_value={"buildRunId": "apple-run"})
    @patch.object(cloud, "prepare", return_value={"branch": "xcode-cloud/ios-request", "prepared_sha": "prepared"})
    @patch.object(cloud, "resolve_workflow", return_value=("app", "workflow"))
    @patch.object(cloud, "published_source", return_value="source")
    def test_wrong_apple_commit_is_reported_with_existing_run(self, source, workflow, prepare, api, command):
        with patch.object(cloud.sys, "argv", ["mobile-cloud.py"]), patch("sys.stdout", new_callable=io.StringIO):
            with self.assertRaisesRegex(RuntimeError, "apple-run selected a different commit"):
                cloud.main()


if __name__ == "__main__":
    unittest.main()
