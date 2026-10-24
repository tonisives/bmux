# Mobile integration

The canonical wire contract is [remote-mobile-contract.md](../docs/remote-mobile-contract.md).
Shared DTOs live in src/shared/remote-management.ts, remote-attention.ts,
remote-mobile-auth.ts and remote-account.ts. Hosted auth, account ownership,
attention delivery and host primitives belong to the backend workstream.

## Onboarding and layout

Try demo opens two local sample pages without authentication or signaling. It
starts in Watch, requires Take control before confirming stock, and requires an
explicit Resume demo agent. The shared session list is also used for connected
hosts. Wide screens show list and detail side by side; phones show one at a time.
Controls use pill shapes and rows use rounded inset groups with neutral fills.

When sessions exist, connection setup moves below the list. The included-browser
promotion is hidden when that browser already has listed pages; a browser that
has not been opened is a compact optional row. New accounts can open an entitled
included browser in one action. Their default profile comes from the host.

## Native authentication

The app opens /api/auth/mobile/start in the system browser with S256 PKCE,
a fresh state and redirect_uri=bmux-remote://auth/callback. It accepts only
the exact callback URI, matching state and a single opaque code. The code is
exchanged at /api/auth/mobile/exchange with codeVerifier. No bearer is accepted
from a URL.

RemoteNativeCredentials are stored in SecureStore. Concurrent requests share
one /api/auth/mobile/refresh operation. Refresh must retain the owner and rotate
both tokens. Sign-out waits for an active refresh, calls /api/auth/mobile/logout
with the latest bearer, removes the push binding, and clears local credentials.
A late sign-in or refresh cannot restore a signed-out account. Web retains its
same-origin HttpOnly cookie and needs POST /api/logout.

The backend must bind native kind to the authenticated session and single-use
viewer ticket. Native WebSocket admission permits absent Origin only for that
ticket kind. Browser Origin checks stay strict. The app sends no desktop header.
Apple linking must retain the Google owner through explicit reauthentication.
Privacy policy and support links are available before sign-in and in Settings.

## Profiles, sessions and pages

Signed manage signaling establishes a data-only WebRTC peer without a live-view
slot. Typed RPC runs exclusively over its encrypted channel. Switching to a live
page closes management; opening settings closes the live view and its lease.

The UI discovers the ready default profile and saved profiles. It creates a
session with its initial page, creates pages under a session lease, and sends
opaque revisions for existing-session mutations. The current encrypted state
supplies session.revision, session.defaultProfileId, pane.profileId and
pane.connectionId. New hosts advertise management capabilities; unsupported
actions remain hidden. The backend workstream is finalizing these state fields.

Proxy credentials are write-only and stay in local form state until sent over
WebRTC. Keep, replace and clear are explicit. Testing can use an unsaved proxy
draft. Saving changes the default connection for new pages. Reopening an
existing page with a saved connection is an explicit action under its lease and
preserves the page profile. No proxy credentials go to account HTTP endpoints.

## Attention

The inbox reads /api/attention?v=2 with cursor pagination. Read/dismiss mutations
change inbox metadata only. Expo push data contains only attentionId. Opening a
notification resolves the authenticated exact host generation, session, pane
and episode, then starts in Watch. It never acquires control or resumes.

Resume requires a current lease and fresh attention resolution. A persisted
request UUID is reused after lost acknowledgements. Only a matching revisioned
RemoteResumeAcknowledgement starts Verifying and releases the lease. A lost
acknowledgement can be recovered from the matching persisted server attempt.
Recovery retains a result that has already completed verification or returned
to pending; it does not move it back to Verifying. The displayed attention must
match the host's current episode, and revisions are compared within one event.
The app polls the target for the originating agent's verification result;
failure or timeout remains paused and permits a fresh revision to be retried.
Leave paused releases the live view without changing the attention event.
The backend has not yet specified a separate cannot-complete operation.

## Quality and included browser

Auto quality uses Wi-Fi quality and cellular/unknown Data saver. Manual Auto,
Data saver and Quality preferences are stored per account. Quality messages
change capture/encoder settings independently of the page viewport. Pinch/pan
is local; Take control preserves zoom. Only Fit to phone requests a host resize.
Closing text entry clears its draft. Changing the target or control lease also
clears text and closes page-action sheets.

GET /api/hosted-browser supplies the included browser state. Open uses a
persisted requestId at POST /api/hosted-browser/open, polls pending states, and
watches only a ready exact target. Resource, idle and retention policies come
from the server. The included browser uses the relay entitlement on the existing
tgs node; it offers no shell or scripting API. The backend must preserve working
sign-in popups within its interactive browser limit.

## Release checks

Source builds do not verify deployed flows. Before release, exercise real
hosted Google/Apple auth, native-kind ticket admission, direct and TURN video,
control/viewport restoration, cold/warm push opening, duplicate/lost resume
acknowledgements, script success/failure, default profile and proxy setup,
session/page creation, quality changes, included-browser wake/sleep and the
account-wide two-view limit. Metadata-only management must consume no view.

The separate Expo project is @tonisives/bmux-remote, ID
bb9e879b-323b-4054-a2b1-e3d9f86de092. APNs/FCM credentials, Apple association and
Android assetlinks files are required for cc.bmux.remote. Serve the Metro web export and
/attention/:id routes on the remote service origin. Purchases stay on the web.
