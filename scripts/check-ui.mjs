import { _electron as electron, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

let root = process.cwd()
let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'browmux-ui-'))
let target = process.env.BROWMUX_TEST_URL ?? 'https://example.com/'
let keepOpen = process.argv.includes('--keep-open')
let installed = process.argv.includes('--installed')
let appPath = path.join(os.homedir(), 'workspace', '_tools', 'Browmux.app', 'Contents', 'MacOS', 'Browmux')
let application = await electron.launch({ ...(installed ? { executablePath: appPath } : {}), args: installed ? [] : [root], env: { ...process.env, BROWMUX_DATA_DIR: directory, BROWMUX_BACKGROUND: '0', BROWMUX_DEBUG: '1' } })
try {
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html')), { timeout: 20000 }).toBe(true)
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let prompt = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await prompt.fill(target)
  await prompt.press('Enter')
  await expect(prompt).toHaveCount(0, { timeout: 45000 })
  await expect(chrome.getByRole('button', { name: 'Address', exact: true })).toContainText(new URL(target).hostname)
  let visible = await application.evaluate(({ BaseWindow }, target) => {
    let window = BaseWindow.getAllWindows().find(window => window.isVisible())
    let view = window?.contentView.children.find(view => 'webContents' in view && view.webContents.getURL().startsWith(target))
    return view ? { bounds: view.getBounds(), url: view.webContents.getURL(), title: view.webContents.getTitle() } : null
  }, target)
  if (!visible || visible.bounds.width < 600 || visible.bounds.height < 300) throw new Error('The URL loaded without attaching a visible page')
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true })
  // Park the view briefly to capture its actual rendered preview together with the status bar.
  let clientId = await chrome.evaluate(async () => (await window.browmux.state()).clientId)
  await chrome.evaluate(client => window.browmux.command({ method: 'client.overlay', args: { client, visible: true } }), clientId)
  await chrome.waitForTimeout(200)
  await chrome.screenshot({ path: path.join(root, 'artifacts/url-opened.png') })
  await chrome.evaluate(client => window.browmux.command({ method: 'client.overlay', args: { client, visible: false } }), clientId)
  console.log(JSON.stringify({ passed: 'Typed a real URL, submitted Enter, and verified visible native page rendering', ...visible, debugPid: application.process().pid }))
  if (keepOpen) { console.log('Debug browser is open with isolated temporary profiles. Quit it to finish.'); await new Promise(resolve => application.on('close', resolve)) }
} finally {
  await application.close().catch(() => undefined)
  await fs.rm(directory, { recursive: true, force: true })
}
