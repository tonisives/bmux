import { expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

let exec = promisify(execFile)
let runner = path.resolve('scripts/tart.mjs')

it.each(['electron', 'ui', 'debug', 'package-smoke', 'bitwarden-desktop'])('routes %s tests to CI instead of launching a local VM', async mode => {
  try {
    await exec(process.execPath, [runner, mode], { env: { ...process.env, GITHUB_ACTIONS: 'false', BMUX_TEST_NATIVE: '1', BUILD_SERVICE_WORKER: '1' } })
    throw new Error('Expected the local test command to fail')
  } catch (error) {
    expect((error as { code: number }).code).toBe(1)
    expect((error as { stderr: string }).stderr).toContain('BMUX tests run in GitHub Actions')
  }
})

it.each(['start', 'stop', 'exec'])('does not manage an independent local test VM: %s', async mode => {
  await expect(exec(process.execPath, [runner, mode], { env: { ...process.env, GITHUB_ACTIONS: 'false' } })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('shared build controller owns the local VM') })
})
