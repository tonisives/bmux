import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'

let fixture = async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-dialogs-'))
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><h1>Comment fixture</h1><button onclick="document.querySelector(\'output\').textContent = confirm(\'Delete this comment?\') ? \'Deleted\' : \'Cancelled\'">Delete</button><button onclick="window.addEventListener(\'beforeunload\', event => { event.preventDefault(); event.returnValue = \'\' }); document.querySelector(\'output\').textContent = \'Unsaved\'">Edit</button><output>Unchanged</output>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  autoUpdateFilters: false\n')
  let application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.fill(url); await address.press('Enter')
  await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
  let page = application.context().pages().find(page => page.url() === url)!
  await expect(page.getByRole('heading')).toHaveText('Comment fixture')
  let close = async () => {
    await application.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
  return { application, chrome, page, url, close }
}

test('website confirmations allow cancellation and acceptance', async () => {
  let { page, close } = await fixture()
  try {
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
  } finally { await close() }
})

test('unsaved changes can cancel or allow tab and window close', async () => {
  let { application, chrome, page, url, close: cleanup } = await fixture()
  try {
    page.on('dialog', () => undefined)
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.locator('output')).toHaveText('Unsaved')
    let tabId = await chrome.evaluate(async () => {
      let state = await (window as any).bmux.state()
      return state.model.sessions[0].windows[0].panes[0].id as string
    })
    await application.evaluate(({ dialog }) => {
      let native = dialog.showMessageBoxSync
      let choices = [0, 1, 0, 1]
      ;(dialog as any).showMessageBoxSync = (...args: unknown[]) => {
        let options = args.at(-1) as Electron.MessageBoxOptions
        if (options.message === 'Leave this site?') return choices.shift() ?? 0
        return (native as any)(...args)
      }
    })
    let closeTab = () => chrome.evaluate(({ tabId }) => (window as any).bmux.command({ method: 'kill-pane', args: { pane: tabId } }), { tabId })
    expect(await closeTab()).toEqual({ cancelled: tabId })
    await expect(page.locator('output')).toHaveText('Unsaved')
    expect(await closeTab()).toEqual({ closed: tabId })
    await expect.poll(() => application.context().pages().some(candidate => candidate.url() === url)).toBe(false)
    let { windowId, nextTabId } = await chrome.evaluate(async () => {
      let state = await (window as any).bmux.state()
      let current = state.model.sessions[0].windows[0]
      return { windowId: current.id as string, nextTabId: current.panes[0].id as string }
    })
    await chrome.evaluate(({ nextTabId, url }) => (window as any).bmux.command({ method: 'navigate', args: { tab: nextTabId, url } }), { nextTabId, url })
    await expect.poll(() => application.context().pages().some(candidate => candidate.url() === url)).toBe(true)
    let replacement = application.context().pages().find(candidate => candidate.url() === url)!
    replacement.on('dialog', () => undefined)
    await replacement.getByRole('button', { name: 'Edit' }).click()
    let closeWindow = () => chrome.evaluate(({ windowId }) => (window as any).bmux.command({ method: 'kill-window', args: { window: windowId, confirm: true } }), { windowId })
    expect(await closeWindow()).toEqual({ cancelled: windowId })
    await expect(replacement.locator('output')).toHaveText('Unsaved')
    expect(await closeWindow()).toEqual({ closed: windowId })
    await expect.poll(() => application.context().pages().some(candidate => candidate.url() === url)).toBe(false)
  } finally { await cleanup() }
})
