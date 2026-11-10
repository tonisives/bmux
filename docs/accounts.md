# Accounts workspace preview

Enable `BMUX_ACCOUNTS_PREVIEW=true` on the relay service to expose Accounts in the web viewer and `/accounts`. It is off by default.

This preview stores projects, personas, draft platform accounts and blocked calendar entries. Accounts have isolated logical records; browser profiles are not provisioned yet. The calendar is an agenda. Entries can be cancelled, but cannot execute.

The same authenticated owner scopes all `/api/v1` requests. Browser mutations require the existing same-origin session protections. Public API tokens are not implemented yet.

Available operations:

- GET `/api/v1/accounts/overview`
- POST `/api/v1/projects`: `name`, `timezone`
- POST `/api/v1/personas`: `projectId`, `name`, `interests`
- POST `/api/v1/accounts`: `personaId`, `platform`, `handle`
- POST `/api/v1/schedules`: `accountId`, `kind`, `job`, `inputs`, `scheduledAt`, `durationMinutes`
- POST `/api/v1/schedules/:id/cancel`

Supported platform identifiers: `tiktok`, `instagram`, `youtube`, `x`, `reddit`, `linkedin`. Schedule kinds: `warmup`, `post`, `analytics`. Times require an explicit timezone offset; the UI converts the local input to UTC. Project timezone controls agenda display.

## Remaining implementation

Identity sealing and runtime enforcement; account execution ownership; proxy entitlement provisioning and HomeProxy pairing; host job execution and durable retries; recurring calendar schedules; API tokens and idempotency; encrypted full-profile migration; six platform warmup and analytics adapters; centralized recordings and retention; webhook configuration and delivery status; growth charts; week and month calendar views.

Do not enable automated execution until host enforcement and fenced ownership are implemented and verified.
