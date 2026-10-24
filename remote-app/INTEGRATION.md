# Mobile integration

The native client is in this directory. Hosted account auth, account ownership,
attention delivery/state and host primitives stay in the backend workstream.
The contract below is implemented by the client and still needs server support.

## Hosted sign-in

GET /api/config advertises nativeAuth:

    {
      "protocol": 1,
      "clientId": "bmux-remote",
      "authorizationEndpoint": "/api/auth/authorize",
      "tokenEndpoint": "/api/auth/token",
      "revocationEndpoint": "/api/auth/revoke"
    }

The paths can differ; the client accepts same-origin /api/ endpoints advertised
by the service. Native requests omit browser cookies. The system browser opens
the authorization endpoint using response_type=code, client_id=bmux-remote,
redirect_uri=bmux-remote://auth/callback, state, code_challenge and
code_challenge_method=S256. Scopes are openid, email and profile.

The hosted screen offers Google and Apple. The server retains the existing
Google subject owner. Linking another provider requires explicit account
reauthentication; matching email alone must not change or merge owner IDs.

The server returns only code and the original state to the callback. The app
checks the exact callback URI and state before exchanging the code. No bearer
is accepted from a URL. POST tokenEndpoint takes JSON:

    {
      "grant_type": "authorization_code",
      "client_id": "bmux-remote",
      "code": "opaque single-use code",
      "code_verifier": "original PKCE verifier",
      "redirect_uri": "bmux-remote://auth/callback"
    }

The token response is:

    {
      "owner": "existing account owner",
      "accessToken": "64 lowercase hex characters",
      "expiresAt": "ISO timestamp",
      "refreshToken": "64 lowercase hex characters",
      "refreshExpiresAt": "ISO timestamp"
    }

Refresh uses the same endpoint with grant_type=refresh_token, client_id and
refresh_token. Both tokens rotate in the response. The app coalesces concurrent
refreshes, requires the same owner and prevents a late refresh from restoring a
signed-out session. Store credentials stay in SecureStore.

POST revocationEndpoint takes client_id, token and token_type_hint. The app
revokes its refresh token on sign-out and removes the local session even when
the network fails. Web also needs POST /api/logout to revoke and clear its
existing HttpOnly login cookie.

Native issuance must bind client kind to the authenticated session. The existing
POST /api/connect then issues a single-use native viewer ticket. The WebSocket
server permits absent Origin only for that authenticated ticket kind and keeps
strict web Origin checks. The app supplies no desktop Origin header.

## Attention and hosting

The existing Expo registration endpoints and opaque attentionId push data are
used directly. Opening resolves GET /api/attention/:id and requires its exact
host generation, session, pane and active episode. Opening always watches.

The remaining server/host contracts are:

- Durable pending, claimed, verifying, resolved, failed and expired attention
  states; explicit claim and cannot-complete actions.
- An episode/revision acknowledgement durably stored by the host before waking
  the originating help waiter. The client releases control after that ack and
  shows Verifying until the script reports success or failure. A generic
  resumed=true response is not verification.
- Host capabilities and safe profile discovery, including the ready default
  profile; create session/page on attached or rented hosts; proxy set/test with
  credentials retained only on the host. Profile and connection IDs remain
  separate. Mutating a saved proxy must state which new connection it affects.
- Stream quality independent from the website viewport. Auto selects Data
  Saver on cellular; manual settings override that choice.
- Included browser status and wake on the existing tgs node, isolated per
  account, one primary interactive page plus auth popups. Persist its profile
  and saved URL, then sleep 15 minutes after the last viewer. No shell, external
  agent API or scripting tools are included in this browser offering.
- The existing account-wide maximum of two simultaneous live pane views applies
  to direct and TURN connections. List/profile metadata does not consume a view.
- Same-origin web hosting plus /attention/:id routing, Apple association and
  Android assetlinks files for the separate cc.bmux.remote app.

The existing attention resume primitive is not exposed as the finished mobile
Resume action until the durable acknowledgement and script verification path
is available. Source builds alone do not verify these runtime paths.
