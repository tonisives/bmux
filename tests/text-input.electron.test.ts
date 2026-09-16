import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let exec = promisify(execFile)

test('contextual zoom preserves native undo and accessibility focus in browser text inputs', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-text-input-'))
  let config = path.join(directory, 'config.yaml')
  await fs.writeFile(config, 'accessibility: true\nkeyboard:\n  shortcuts:\n    Cmd+Z: { action: toggle-pane-zoom, when: pane-not-editing }\n')
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>Text input fixture</title><button id="surface">Page content</button><label>Text<input id="text"></label><label>Notes<textarea id="notes"></textarea></label><div contenteditable="true" role="textbox" aria-label="Editor">Editable text</div>')
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
    await address.press('Backspace')
    await expect(address).toHaveValue(url.slice(0, -1))
    await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "z" using command down'])
    await expect(address).toHaveValue(url)
    await address.press('Enter')
    await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    let zoomed = () => chrome.evaluate(async () => {
      let state = await (window as any).bmux.state()
      return !!state.model.clients.find((client: any) => client.id === state.clientId).zoomedPaneId
    })
    let cmdZ = () => exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "z" using command down'])
    await page.locator('#surface').click()
    await cmdZ()
    await expect.poll(zoomed).toBe(true)
    await cmdZ()
    await expect.poll(zoomed).toBe(false)
    await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(url)
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    await expect(address).toHaveValue(url)
    await address.press('Backspace')
    await expect(address).toHaveValue('')
    await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "z" using command down'])
    await expect(address).toHaveValue(url)
    await address.press('Control+w')
    await expect(address).not.toHaveValue(url)
    await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "z" using command down'])
    await expect(address).toHaveValue(url)
    let prefix = url.slice(0, 12)
    await address.press('Meta+A')
    await address.pressSequentially(prefix)
    await expect(address).toHaveValue(url)
    await address.press('Backspace')
    await expect(address).toHaveValue(prefix)
    await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "z" using command down'])
    await expect(address).toHaveValue(url)
    await address.press('Escape')
    await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click()
    let command = chrome.getByRole('combobox', { name: 'Command', exact: true })
    await command.pressSequentially('browser tools')
    await command.press('Backspace')
    await expect(command).toHaveValue('browser tool')
    await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "z" using command down'])
    await expect(command).toHaveValue('browser tools')
    await command.press('Escape')
    for (let name of ['Text', 'Notes', 'Editor']) {
      let input = page.getByRole('textbox', { name, exact: true })
      await input.click()
      await expect(input).toBeFocused()
      await expect.poll(focusedRole).toMatch(/^AXText(Field|Area)$/)
      await input.press('Meta+A')
      await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "ugug"'])
      if (name === 'Editor') await expect(input).toHaveText('ugug')
      else await expect(input).toHaveValue('ugug')
      await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to key code 51'])
      await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "z" using command down'])
      if (name === 'Editor') await expect(input).toHaveText('ugug')
      else await expect(input).toHaveValue('ugug')
      expect(await zoomed()).toBe(false)
    }
    await page.evaluate(url => {
      let host = document.createElement('div')
      host.id = 'shadow-editor'
      host.attachShadow({ mode: 'open' }).innerHTML = '<input aria-label="Shadow editor">'
      document.body.append(host)
      let frame = document.createElement('iframe')
      frame.id = 'cross-frame'
      frame.src = url.replace('127.0.0.1', 'localhost')
      document.body.append(frame)
      let same = document.createElement('iframe')
      same.id = 'same-frame'
      same.src = url
      document.body.append(same)
    }, url)
    for (let input of [page.getByRole('textbox', { name: 'Shadow editor' }), page.frameLocator('#same-frame').getByRole('textbox', { name: 'Text', exact: true }), page.frameLocator('#cross-frame').getByRole('textbox', { name: 'Text', exact: true })]) {
      await input.click()
      await input.pressSequentially('context')
      await input.press('Backspace')
      await cmdZ()
      await expect(input).toHaveValue('context')
      expect(await zoomed()).toBe(false)
      await page.locator('#surface').click()
      await cmdZ()
      await expect.poll(zoomed).toBe(true)
      await cmdZ()
      await expect.poll(zoomed).toBe(false)
    }
    for (let frame of [page.frameLocator('#same-frame'), page.frameLocator('#cross-frame')]) {
      await frame.locator('#surface').click()
      // A newly attached frame remains conservative until its observer is ready.
      await expect.poll(async () => {
        await cmdZ()
        return zoomed()
      }).toBe(true)
      await cmdZ()
      await expect.poll(zoomed).toBe(false)
    }
    await page.evaluate(() => {
      let host = document.createElement('div')
      host.id = 'closed-editor'
      let root = host.attachShadow({ mode: 'closed' })
      root.innerHTML = '<input>'
      document.body.append(host)
      ;(root.firstElementChild as HTMLInputElement).focus()
    })
    await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "closed"'])
    await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to key code 51'])
    await cmdZ()
    expect(await zoomed()).toBe(false)
    await page.evaluate(() => { document.designMode = 'on'; document.body.focus() })
    await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "document"'])
    await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to key code 51'])
    await cmdZ()
    expect(await zoomed()).toBe(false)
    await page.evaluate(() => { document.designMode = 'off' })
    await page.reload()
    await page.locator('#surface').click()
    await cmdZ()
    await expect.poll(zoomed).toBe(true)
    await cmdZ()
    await expect.poll(zoomed).toBe(false)
    await application.evaluate(({ Menu }) => {
      let browser = Menu.getApplicationMenu()!.items.find(item => item.label === 'Browser')!
      if (browser.submenu!.items.find(item => item.label === 'toggle-pane-zoom')!.accelerator) throw new Error('Conditional shortcut registered globally')
    })
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
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let current = await chrome.evaluate(() => (window as any).bmux.state())
    let client = current.model.clients.find((item: any) => item.id === current.clientId)
    let secondUrl = `${url}/second`
    let second = await rpc('split-window', { pane: client.paneId, url: secondUrl })
    await rpc('select-pane', { client: client.id, pane: second.id })
    await expect.poll(() => application.context().pages().some(page => page.url() === secondUrl)).toBe(true)
    let secondPage = application.context().pages().find(page => page.url() === secondUrl)!
    await secondPage.locator('#text').click()
    await secondPage.locator('#text').pressSequentially('second')
    await secondPage.locator('#text').press('Backspace')
    await cmdZ()
    await expect(secondPage.locator('#text')).toHaveValue('second')
    expect(await zoomed()).toBe(false)
    await rpc('select-pane', { client: client.id, pane: client.paneId })
    await page.locator('#surface').click()
    await cmdZ()
    await expect.poll(zoomed).toBe(true)
    await cmdZ()
    await expect.poll(zoomed).toBe(false)
    await fs.writeFile(config, 'keyboard:\n  shortcuts:\n    Cmd+Z: null\n    Cmd+ShiftLeft: { action: toggle-pane-zoom, when: pane-not-editing }\n')
    await expect.poll(() => chrome.evaluate(async () => (await (window as any).bmux.state()).keyboard.shortcuts['Cmd+Z'])).toBeUndefined()
    await cmdZ()
    expect(await zoomed()).toBe(false)
    // Match the existing modifier-only routing test; native Cmd+Z is exercised above.
    let modifier = () => application.evaluate(({ webContents }) => {
      let contents = webContents.getFocusedWebContents()!
      for (let type of ['keyDown', 'keyUp']) (contents as any).emit('before-input-event', { preventDefault: () => undefined }, { type, key: 'Shift', code: 'ShiftLeft', meta: true, control: false, alt: false, shift: type === 'keyDown' })
    })
    await modifier()
    await expect.poll(zoomed).toBe(true)
    await modifier()
    await expect.poll(zoomed).toBe(false)
    await page.locator('#text').click()
    await modifier()
    expect(await zoomed()).toBe(false)
  } finally {
    await application.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
