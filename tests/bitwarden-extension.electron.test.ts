import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeTestApplication } from './electron-fixture'
import { installBitwardenExtension } from '../src/main/bitwarden-extension'

for (let release of ['2026.6.1', '2026.10.0']) test(`official Bitwarden ${release} keeps login ports working across profiles and idle time`, async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-extension-probe-'))
  let installed = process.env.BMUX_TEST_INSTALLED === '1'
  let application = await electron.launch({ ...(installed ? { executablePath: path.resolve(process.env.BMUX_OUTPUT_DIR || 'build', 'bmux.app/Contents/MacOS/bmux') } : {}), args: installed ? [] : [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let rpc = (method: string, args: Record<string, unknown>) => test.step(`${method} ${args.profile ?? ''}`, () => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args }), { timeout: method === 'extension.install-bitwarden' ? 60000 : 20000 })
    let installed = await test.step('Install the pinned official extension', async () => {
      if (release === '2026.6.1') return rpc('extension.install-bitwarden', { profile: 'profile_default' })
      let location = await installBitwardenExtension(directory, path.join(directory, 'extension-packages', `bitwarden-${release}`), release)
      return rpc('extension.load', { profile: 'profile_default', path: location })
    }) as { name: string; path: string; version: string }
    expect(installed.name).toBe('Bitwarden Password Manager')
    expect(installed.version).toBe(release)
    expect(await fs.readFile(path.join(installed.path, 'background.js'), 'utf8')).toContain('bmux-inline-new-item-existing-popout-check')
    expect(await fs.readFile(path.join(installed.path, 'background.js'), 'utf8')).toContain('bmux-passkey-unlock-preflight')
    expect(await fs.readFile(path.join(installed.path, 'background.js'), 'utf8')).toContain('bmux-locked-inline-targeting-rules')
    let other = await rpc('profile.create', { name: 'bot (Brave)' })
    for (let profile of ['profile_default', 'profile_bot', other.id]) {
      await test.step(`Verify login and ports in ${profile}`, async () => {
        if (profile !== 'profile_default') await rpc('extension.load', { profile, path: installed.path })
        await rpc('extension.open', { profile, id: 'Bitwarden' })
        await expect.poll(() => application.context().pages().some(page => page.url().startsWith('chrome-extension://'))).toBe(true)
        let popup = application.context().pages().find(page => page.url().startsWith('chrome-extension://'))!
        await expect(popup.getByRole('textbox', { name: /email/i })).toBeVisible({ timeout: 20000 })
        await expect(popup.getByText('An error has occurred', { exact: true })).toHaveCount(0)
        // Resolving optional feature flags must not hold field collection until
        // an account is unlocked. Exercise the real worker and message bridge.
        expect(await popup.evaluate(async () => {
          let view = window as any
          return Promise.race([
            view.chrome.runtime.sendMessage({ command: 'getUrlAutofillTargetingRules' }).then((response: any) => response),
            new Promise(resolve => setTimeout(() => resolve({ error: 'targeting rules stalled' }), 3000)),
          ])
        })).toEqual({ result: null })
        await popup.screenshot({ path: test.info().outputPath(`bitwarden-${profile}-login.png`) })
        if (profile === other.id) {
          await popup.evaluate(() => {
            let view = window as any
            let port = view.chrome.runtime.connect({ name: 'browser-task-scheduler-port' })
            view.fixturePort = port
            port.onDisconnect.addListener(() => { view.fixtureDisconnected = view.chrome.runtime.lastError?.message ?? 'disconnected' })
          })
          // Cross Chromium's normal worker idle timeout before writing login state.
          await new Promise(resolve => setTimeout(resolve, 35000))
          expect(await popup.evaluate(() => (window as any).fixtureDisconnected)).toBeUndefined()
          await popup.evaluate(() => (window as any).fixturePort.postMessage({ action: 'noop' }))
        }
        await popup.route('https://**/*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(route.request().url().includes('prelogin') ? { kdf: 0, kdfIterations: 600000 } : {}) }))
        await popup.getByRole('textbox', { name: /email/i }).fill('fixture@example.test')
        await popup.getByRole('checkbox', { name: 'Remember email' }).check()
        await popup.getByRole('button', { name: 'Continue', exact: true }).click()
        await expect(popup.getByRole('textbox', { name: /master password/i })).toBeVisible({ timeout: 20000 })
        await expect(popup.getByText('Attempting to use a disconnected port object', { exact: true })).toHaveCount(0)
        await test.step(`Close popup in ${profile}`, () => popup.close(), { timeout: 10000 })
      })
    }
  } finally {
    await test.step('Close the disposable extension browser', () => closeTestApplication(application))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
