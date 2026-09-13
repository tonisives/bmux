import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let exec = promisify(execFile)

test('native accessibility focus follows URL and website text inputs', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-text-input-'))
  let config = path.join(directory, 'config.yaml')
  await fs.writeFile(config, 'accessibility: true\nkeyboard: {}\n')
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>Text input fixture</title><label>Text<input id="text"></label><label>Notes<textarea id="notes"></textarea></label><div contenteditable="true" role="textbox" aria-label="Editor">Editable text</div>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/ug-url`
  let application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: config, BMUX_BACKGROUND: '0' } })
  let focusedRole = async () => (await exec('/usr/bin/osascript', ['-e', `tell application "System Events" to tell first application process whose unix id is ${application.process().pid} to get role of (value of attribute "AXFocusedUIElement")`])).stdout.trim()
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await expect(address).toBeFocused()
    await expect.poll(focusedRole).toBe('AXTextField')
    await address.pressSequentially(url)
    await expect(address).toHaveValue(url)
    await address.press('Enter')
    await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(url)
    for (let name of ['Text', 'Notes', 'Editor']) {
      let input = page.getByRole('textbox', { name, exact: true })
      await input.click()
      await expect(input).toBeFocused()
      await expect.poll(focusedRole).toMatch(/^AXText(Field|Area)$/)
      await input.press('Meta+A')
      await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "ugug"'])
      if (name === 'Editor') await expect(input).toHaveText('ugug')
      else await expect(input).toHaveValue('ugug')
    }
    // Use native input: automation commands can bypass browser shortcut handling.
    await page.evaluate(() => {
      let overlay = document.createElement('div')
      overlay.id = 'escape-overlay'
      overlay.textContent = 'Search details'
      document.body.append(overlay)
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') overlay.remove()
      }, { once: true })
    })
    await expect(page.locator('#escape-overlay')).toBeVisible()
    await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to key code 53'])
    await expect(page.locator('#escape-overlay')).toHaveCount(0)
    // Accessibility actions can open controls without a native mouse click.
    await chrome.getByRole('button', { name: 'Address', exact: true }).evaluate(button => (button as HTMLButtonElement).click())
    await expect(address).toBeFocused()
    await expect.poll(focusedRole).toBe('AXTextField')
    await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "ugug"'])
    await expect(address).toHaveValue('ugug')
    await address.press('Escape')
    await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(url)
  } finally {
    await application.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
