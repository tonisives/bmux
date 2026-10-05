# Windows tests

The [Windows workflow](../.github/workflows/windows.yml) runs on a disposable
Windows 2022 desktop with Node 24. It builds the x64 NSIS installer, installs it
silently into a temporary path with spaces, and runs `pnpm test:windows`.
The normal macOS suite stays in Check. Release runs the same Windows suite
against its installer before uploading it.

The focused unit suite covers native IPC, Windows paths, keyboard/configuration,
plugin authentication, cancellation, timeouts and shutdown. The startup suite
checks the installed executable opens a visible window, the installed CLI can
start and control it, local fixture pages render, external and bundled plugins
communicate over named pipes, forged plugin tokens are rejected, and the same
isolated data directory can restart. Profile paths include spaces and Unicode.
Tests use temporary data/configuration and never open a real browser profile.

Run it through workflow dispatch:

```sh
gh workflow run windows.yml --ref YOUR_BRANCH
```

On a disposable Windows desktop, install the built package and run:

```powershell
$env:BMUX_WINDOWS_APP = 'C:\test install\bmux.exe'
pnpm test:windows
```

The suite refuses to run on other platforms. Local macOS GUI tests continue to
use Tart. Windows CI retains the tested installer and Playwright diagnostics;
release failures retain diagnostics and prevent installer publication.

Windows IPC uses named pipes under `\\.\pipe\`. Unix continues to use the
existing control socket address with 0700 directories and 0600 sockets. Plugin
pipes are unique to each host and still require a per-invocation token. Windows
pipe cleanup belongs to the OS; no filesystem chmod, ownership or unlink
operations run against those endpoints.
