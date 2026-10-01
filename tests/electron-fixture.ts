import type { ElectronApplication } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'

// Dispose only the test-owned process when extension ports or remote streams
// prevent graceful shutdown. Keep teardown from masking an assertion failure.
export let closeTestApplication = async (application?: ElectronApplication, process?: ChildProcess) => {
  if (!application) return
  // Playwright can dispose its application dispatcher after a disconnection.
  // Callers exercising crashes can retain the process immediately after launch.
  let child = process ?? application.process()
  let exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(resolve => child.once('exit', () => resolve()))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      application.close().catch(() => undefined),
      new Promise<void>(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); void exited.then(resolve) }, 10000) }),
    ])
    await exited
  } finally { clearTimeout(timer) }
  if (['SIGSEGV', 'SIGABRT', 'SIGILL', 'SIGBUS'].includes(child.signalCode ?? '') || [132, 134, 135, 139].includes(child.exitCode ?? 0)) {
    throw new Error(`Electron main process crashed: ${child.signalCode ?? child.exitCode}`)
  }
}
