import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'

test('website confirmations allow cancellation and acceptance', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-dialogs-'))
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><h1>Comment fixture</h1><button onclick="document.querySelector(\'output\').textContent = confirm(\'Delete this comment?\') ? \'Deleted\' : \'Cancelled\'">Delete</button><output>Unchanged</output>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  autoUpdateFilters: false\n')
  let application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url); await address.press('Enter')
    await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await expect(page.getByRole('heading')).toHaveText('Comment fixture')
    for (let accept of [false, true]) {
      let handled = new Promise<void>((resolve, reject) => page.once('dialog', async dialog => {
        try {
          expect(dialog.type()).toBe('confirm')
          expect(dialog.message()).toBe('Delete this comment?')
          if (accept) await dialog.accept()
          else await dialog.dismiss()
          resolve()
        } catch (error) { reject(error) }
      }))
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await handled
      await expect(page.locator('output')).toHaveText(accept ? 'Deleted' : 'Cancelled')
    }
  } finally {
    await application.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
