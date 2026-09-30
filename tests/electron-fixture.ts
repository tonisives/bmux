import type { ElectronApplication } from '@playwright/test'

// Dispose only the test-owned process when extension ports or remote streams
// prevent graceful shutdown. Keep teardown from masking an assertion failure.
export let closeTestApplication = async (application?: ElectronApplication) => {
  if (!application) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      application.close().catch(() => undefined),
      new Promise<void>(resolve => { timer = setTimeout(() => { application.process().kill('SIGKILL'); resolve() }, 10000) }),
    ])
  } finally { clearTimeout(timer) }
}
