import { host } from '../host.mjs'

// The main process owns the vault and continuation; the plugin receives no secrets.
try { await host('result', await host('bitwarden.fill')) }
catch { process.exitCode = 1 }
