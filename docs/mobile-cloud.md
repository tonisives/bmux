# Mobile builds in Xcode Cloud

`make archive-and-upload-mobile` prepares the iOS project on GitHub, starts an
Xcode Cloud archive, and prints the run ID and TestFlight link. Compilation,
signing, and upload run on Apple's servers. It never falls back to local builds.

Commit and push the app source first. The command rejects an unpublished or
dirty source checkout. To deliberately build a different published branch, use
`make archive-and-upload-mobile MOBILE_CLOUD_REF=main` (use `prod` for Trend Seeker).
Add `MOBILE_CLOUD_ARGS=--wait` to wait for the archive and verify that App Store
Connect has processed the uploaded build. Without it, the command returns after
Apple accepts the run; upload continues remotely.

## One-time enrollment

1. Install `gh` and `asc`, sign in to GitHub, and configure an App Store Connect
   team API key with access to the app and Xcode Cloud. Keep its `.p8` outside
   the repository. `asc auth login --help` lists the keychain setup options.
2. Run `make prepare-mobile-cloud`. This needs only GitHub authentication.
   A Linux GitHub job installs dependencies and runs Expo prebuild without
   compiling. It publishes a unique `xcode-cloud/ios-…` branch containing the
   generated project, workspace, and `ci_scripts` hook.
3. Fetch that branch into a separate worktree, open its generated iOS workspace
   in Xcode, and enroll the app using Product > Xcode Cloud > Create Workflow.
   Connect the source repository and grant access to any additional dependencies.
4. Name the workflow **Mobile TestFlight**. Select the generated workspace and
   app scheme listed in `scripts/mobile-cloud.json`. Use an iOS Archive action
   with deployment preparation **TestFlight and App Store**. Apple signs and
   uploads each archive to App Store Connect. Add a TestFlight post-action for
   the desired existing internal tester group if automatic tester distribution
   is wanted. External distribution follows Apple's beta review process.
5. Use manual starts matching all `xcode-cloud/ios-*` branches. Remove automatic
   push, pull request, tag, and scheduled starts so the command starts one build.
   Choose a compatible Xcode version for the app's Expo SDK.
6. Set the product's next Xcode Cloud build number higher than its latest
   TestFlight upload. The post-clone hook applies `CI_BUILD_NUMBER` to the app
   and extension Info.plists. Run the normal upload command and verify the first
   build with `MOBILE_CLOUD_ARGS=--wait`.

The initial product enrollment and source-control consent happen in Xcode;
Apple's public API can manage workflows and builds after enrollment.

## How source preparation works

The command resolves the source commit on GitHub and dispatches
`mobile-cloud-prepare.yml`. The job checks out that exact SHA, uses the app's
pinned pnpm version and frozen lockfile, and generates the native project.
Each request publishes its own branch, so simultaneous builds cannot overwrite
one another. A receipt records both the original and prepared commit; the
command verifies it before starting Apple. Generated files stay off the normal
development branch, preserving Expo's existing prebuild workflow.

Xcode Cloud's post-clone hook installs Node 24, the app's pinned pnpm and CocoaPods,
restores dependencies, installs pods, and updates build numbers. It uses the
prepared project rather than regenerating the workspace selected by Apple.

Preparation uses GitHub-hosted Linux minutes. The archive uses the team's shared
Xcode Cloud allowance of 25 compute hours per month. Quota exhaustion produces
a remote error; there is no automatic local or Linux K3S fallback for iOS.
Delete completed preparation branches once their builds no longer need reruns.

## Monitoring and recovery

Use the printed run ID with `asc xcode-cloud status --run-id ID --wait`, or
`asc xcode-cloud doctor --run-id ID --wait` to inspect failures. If dispatch
times out, inspect the existing GitHub/Xcode Cloud run before retrying to avoid
duplicate uploads. A successful archive and a processed TestFlight upload are
reported separately. The command does not submit an App Store release.

References: [Expo native generation](https://docs.expo.dev/workflow/continuous-native-generation/),
[Apple workflow setup](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow),
[TestFlight upload](https://developer.apple.com/documentation/xcode/distributing-your-xcode-cloud-builds-through-testflight).
