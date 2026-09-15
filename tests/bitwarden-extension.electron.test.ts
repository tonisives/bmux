import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('official Bitwarden reaches its login screen', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-extension-probe-'))
  let installed = process.env.BMUX_TEST_INSTALLED === '1'
  let application = await electron.launch({ ...(installed ? { executablePath: path.resolve(process.env.BMUX_OUTPUT_DIR || 'build', 'bmux.app/Contents/MacOS/bmux') } : {}), args: installed ? [] : [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let rpc = (method: string, args: Record<string, unknown>) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let installed = await rpc('extension.install-bitwarden', { profile: 'profile_default' })
    expect(installed.name).toBe('Bitwarden Password Manager')
    await rpc('extension.open', { profile: 'profile_default', id: 'Bitwarden' })
    await expect.poll(() => application.context().pages().some(page => page.url().startsWith('chrome-extension://'))).toBe(true)
    let popup = application.context().pages().find(page => page.url().startsWith('chrome-extension://'))!
    await popup.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(popup.getByRole('textbox', { name: /email/i })).toBeVisible({ timeout: 20000 })
    await popup.screenshot({ path: test.info().outputPath('bitwarden-login.png') })
  } finally {
    await application.close()
    await fs.rm(directory, { recursive: true, force: true })
  }
})
