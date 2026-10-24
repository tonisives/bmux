# Remote mobile backend contract

Canonical DTOs live in `src/shared/remote-management.ts`, `remote-attention.ts`, `remote-mobile-auth.ts`, and `remote-account.ts`. Capabilities describe implemented support on each connected host. A missing capability means unsupported. Protocol remains 2 and `ready.streamPermits` remains authoritative.

## Host management

Signed signaling `{type:'manage',request}` opens a data-only WebRTC peer with the existing offer/answer/candidate correlation. It requires host access but no live-view permit. `open` continues to subscribe to one exact session/pane and requires a live-view permit. Switching between management and video closes the old peer and releases its lease/permit. Management peers are bounded and have no browser target.

The encrypted data channel accepts `RemoteRPCRequest`. All replies correlate `request`; errors use `{type:'error',request,code,error,retryable?}`. Mutation UUIDs are stable across retries and durably deduplicated on the host. Target runtime generation is bound by the signed connection. Resource revisions are opaque strings. Session/page creation requires control permission; mutations of existing sessions additionally require the current lease. A host starts with `profile_default`. A new session includes its first page and defaults to that profile. Pages always retain their profile identity.

Proxy settings are write-only for credentials and support explicit keep/replace/clear. Saving a default connection preserves open pages. `pages.reopen` applies a saved connection to a page of that same profile, under its lease, preserving the URL. Tests can use saved settings or a temporary draft without saving. Proxy credentials traverse only WebRTC and remain on the host. No credential values, cookies, history, or paths appear in profile metadata.

`quality` accepts `RemoteQualityRequest` and returns `RemoteStreamQuality`; it changes capture/encoding only. Auto uses Data saver on cellular/unknown and quality on Wi-Fi. Explicit mode selection wins. Reconnect starts in watch mode. Backgrounding closes the video peer and releases control; browser work continues independently on local/rented hosts.

## Attention

Existing `/api/attention/devices` and `/remove` use Expo tokens. Push data remains exactly `{attentionId}`. Detail adds the shared DTO fields. `GET /api/attention?v=2&limit=50&cursor=...` returns `RemoteAttentionPage`; unversioned reads remain compatible. `POST /api/attention/:id/inbox` with `{read?:boolean,dismissed?:boolean}` changes only inbox metadata. HTTP resolve is not a human Resume operation.

Verified Resume uses `RemoteResumeRequest`, preserving the existing `resume` type. Host validates the event/revision/runtime/target/control lease and page guard, then commits a durable acknowledgement and verification attempt before acknowledging or waking the originating help waiter. The result is `RemoteResumeAcknowledgement`, not final task success. Native explicitly releases its lease after this acknowledgement. Normal automation stays gated; the bound originator receives the attempt and reports `RemoteAttentionVerification` through the host-local adapter. Verified success resolves the event. Failure returns it to pending with a new revision and leaves automation paused. Timeouts never imply success. Duplicate request/event revisions do not wake another attempt. Old attempt results cannot resolve newer attempts.

## Account and included browser

`GET /api/streams` and `POST /api/streams/disconnect {connection}` manage account-wide live views. Direct and TURN subscriptions both count toward two. Disconnect never resumes automation or stops a local/rented browser.

`GET /api/hosted-browser` returns `IncludedBrowser`. `POST /api/hosted-browser/open {requestId}` idempotently ensures/wakes the singleton account runtime. It returns a target only when the current host/runtime/session/pane is ready. It acquires neither video nor control. The same $10 relay entitlement includes one interactive pane on the existing tgs node. No new region/node pools or billable fallback. Persistent profile and saved page survive sleep; process memory does not. Included hosts enforce one pane, including popups, and expose no external agent API, CLI or shell. Account-isolated runtime/storage and bounded node capacity are enforced server-side. Resource/idle/retention policy is server configuration, not client constants.

## Native authentication

`GET /api/auth/mobile/start?state=...&code_challenge=...&code_challenge_method=S256&redirect_uri=bmux-remote://auth/callback` starts hosted sign-in. `/complete` exchanges the authenticated web cookie for a 60-second single-use code. `POST /exchange {code,codeVerifier}` and `/refresh {refreshToken}` return `RemoteNativeCredentials` (one-hour access, rotating 30-day refresh). `/logout` revokes that native session, its push binding and viewer. Legacy 30-day logins remain unchanged. Native sessions use separate additive metadata tables; `bmux_logins(token_hash,owner,expires)` is unchanged. Google subject remains canonical owner. Apple identities require explicit linking with fresh Google reauthentication; email never links accounts.

Only verified native-session credentials classify a ticket as native. The single-use ticket binds owner, viewer key, login and native session. Only that ticket permits an absent WebSocket Origin. Browser Origin checks remain strict. Native does not use the desktop header. Billing mutations remain web-only for native sessions.

These types are the integration target. Runtime readiness requires the corresponding backend/host implementation and passing integration checks.
