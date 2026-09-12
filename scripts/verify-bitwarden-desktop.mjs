import { _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createProxy } from './fixtures/bitwarden-proxy.mjs'

let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-desktop-vault-'))
let proxy = createProxy('127.0.0.1', 18210, 'http://192.168.64.1:18211')
let application
try {
  application = await electron.launch({ executablePath: '/Applications/Bitwarden.app/Contents/MacOS/Bitwarden', args: [], env: { ...process.env, BITWARDEN_APPDATA_DIR: path.join(directory, 'desktop') }, timeout: 30000 })
  let page = await application.firstWindow()
  await page.waitForTimeout(1500)
  console.log((await page.locator('body').innerText()).slice(0, 4000))
  await fs.mkdir('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/bitwarden-desktop-start.png' })
} finally {
  await application?.close().catch(() => undefined)
  proxy.closeAllConnections(); proxy.close()
  await fs.rm(directory, { recursive: true, force: true })
}
