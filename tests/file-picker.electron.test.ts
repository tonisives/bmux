import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'

test('page file input uses the visible bmux window and receives the chosen file', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-file-picker-'))
  let file = path.join(directory, 'sample.txt')
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>File picker fixture</title><label>Choose file<input id="file" type="file" accept="text/plain" multiple></label><p id="selection"></p><script>document.querySelector("#file").addEventListener("change", event => { document.querySelector("#selection").textContent = event.target.files[0]?.name || "none" })</script>')
  })
  let application: ElectronApplication | undefined
  try {
    await fs.writeFile(file, 'file picker fixture')
    await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  autoUpdateFilters: false\n')
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/fixture`
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html')) as Page
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url)
    await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url) as Page
    await expect(page.locator('#file')).toBeVisible()
    let state = await chrome.evaluate(() => (window as any).bmux.state())
    let tab = state.model.sessions[0].windows[0].panes[0].id as string
    await application.evaluate(({ dialog }, filePath) => {
      ;(globalThis as any).filePickerCalls = []
      dialog.showOpenDialog = (async (owner: any, options: any) => {
        ;(globalThis as any).filePickerCalls.push({ visible: owner.isVisible(), properties: options.properties })
        return { canceled: false, filePaths: [filePath] }
      }) as typeof dialog.showOpenDialog
    }, file)
    await chrome.evaluate(tabId => (window as any).bmux.command({ method: 'click', args: { tab: tabId, selector: '#file' } }), tab)
    await expect.poll(() => application!.evaluate(() => (globalThis as any).filePickerCalls.length)).toBe(1)
    await expect(page.locator('#selection')).toHaveText('sample.txt')
    expect(await application.evaluate(() => (globalThis as any).filePickerCalls)).toEqual([{ visible: true, properties: ['openFile', 'multiSelections'] }])
  } finally {
    await application?.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
