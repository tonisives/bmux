import type { ElectronApplication } from '@playwright/test'

// Dispose only the test-owned process when extension ports or remote streams
// prevent graceful shutdown. Keep teardown from masking an assertion failure.
export let closeTestApplication = async (application?: ElectronApplication) => {
  if (!application) return
  let child = application.process()
  let exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(resolve => child.once('exit', () => resolve()))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      application.close().catch(() => undefined),
      new Promise<void>(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); void exited.then(resolve) }, 10000) }),
    ])
    await exited
  } finally { clearTimeout(timer) }
}
