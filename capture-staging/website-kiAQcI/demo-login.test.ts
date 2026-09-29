import { prepareDemoDisplay } from './demo-display'
import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let exec = promisify(execFile)

test('prepare the Google Cloud demo login', async () => {
  if (process.env.BMUX_TEST_NATIVE !== '1') throw new Error('Use the Tart runner.')
  await prepareDemoDisplay()
  let directory = path.join(os.homedir(), 'bmux-demo-cloud')
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  let application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  let cli = async (method: string, args: Record<string, unknown> = {}) => {
    let result = await exec(process.execPath, [path.join(process.cwd(), 'bin/bmux.mjs'), 'rpc', method, JSON.stringify(args)], { env: { ...process.env, BMUX_DATA_DIR: directory } })
    let response = JSON.parse(result.stdout)
    if (!response.ok) throw new Error(response.error)
    return response.result
  }
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let state = await cli('state'), client = state.model.clients[0]
    let session = state.model.sessions.find((item: { name: string }) => item.name === 'cloud research')
    session ??= await cli('new-session', { name: 'cloud research', profile: 'bot' })
    let pane = session.windows[0].panes[0]
    await cli('switch-client', { client: client.id, session: session.id })
    await cli('select-pane', { client: client.id, pane: pane.id })
    await cli('activate-client', { client: client.id })
    await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find(window => window.isVisible())!.setBounds({ x: 20, y: 105, width: 1344, height: 680 }))
    if (pane.url === 'about:blank') await cli('navigate', { pane: pane.id, url: 'https://console.cloud.google.com/compute/instances' })
    console.log('Google Cloud demo session is ready in the Tart viewer. Sign in, choose the demo project, open Compute Engine, then tell the recording agent you are ready (or quit this demo bmux to save the login). No login screens are recorded.')
    await new Promise<void>(resolve => application.on('close', resolve))
    await fs.writeFile(path.join(directory, 'demo-ready'), 'Dedicated demo login closed by user. Validate console URL before capture.\n', { mode: 0o600 })
  } finally {
    await application.close().catch(() => undefined)
  }
})
