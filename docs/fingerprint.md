# Fingerprint profiles

Open a pane’s Profile settings and choose **Fingerprint**. The profile selector
sits above the settings tabs. Use **Save current** to capture the pane’s device,
proxy endpoint, and locked viewport. Select a saved profile and choose **Edit**
to change those settings without changing an open page.

**Apply to pane** refreshes the current page with the selected fingerprint.
**Lock to browser profile** also makes it the default for new panes with that
browser profile. If an older pane has different settings, choose **Apply and
refresh**. When you save a change, bmux offers to refresh matching panes on
that host.

Enrolled hosts sync saved fingerprints across the same relay account. In
Remote, open **Fingerprint** on the selected session. Take control to apply a
profile to the selected page. **Update available** appears when that page is
using a version that has since changed.

Proxy credentials and browser data stay on their host. For an authenticated
proxy, use **Enter proxy credentials** in Remote to test and save the login on
the destination host. Hosts with a required proxy use their configured route.

**Share profiles** supports JSON export and import for standalone hosts. The
local socket also supports the following commands.

```sh
bmux rpc fingerprint.list '{}'
bmux rpc fingerprint.export '{"fingerprint":"fingerprint_example"}'
bmux rpc fingerprint.import '{"fingerprint":{"version":1,"id":"fingerprint_example","name":"Desktop 1280","viewport":{"width":1280,"height":800}}}'
```
