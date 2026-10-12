import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { sendNativeKeys } from './native-focus'

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
    await closeTestApplication(application)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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

test('unsaved changes use a bmux prompt with Escape to stay and Enter to leave when entering a URL', async () => {
  let { application, chrome, page, url, close } = await fixture()
  try {
    await application.evaluate(({ BaseWindow }) => {
      let window = BaseWindow.getAllWindows().find(window => window.isVisible())!
      window.show(); window.focus()
    })
    page.on('dialog', () => undefined)
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.locator('output')).toHaveText('Unsaved')
    let destination = `${url}?next`
    for (let keyCode of ['Escape', 'Enter']) {
      await chrome.getByRole('button', { name: 'Address', exact: true }).click()
      let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
      await expect(address).toBeFocused()
      await address.fill(destination)
      await address.press('Enter')
      let prompt = chrome.getByRole('alertdialog', { name: 'Leave this site?' })
      await expect(prompt).toBeVisible()
      await expect(prompt.getByRole('button', { name: 'Stay (esc)', exact: true })).toBeFocused()
      await expect(prompt.getByRole('button', { name: 'Leave (enter)', exact: true })).toBeVisible()
      await expect(prompt).toContainText('Changes you made may not be saved.')
      if (keyCode === 'Escape') await prompt.screenshot({ path: test.info().outputPath('unsaved-changes-prompt.png') })
      await sendNativeKeys(application, [{ keyCode }])
      await expect(prompt).toHaveCount(0)
      if (keyCode === 'Escape') {
        await expect(page).toHaveURL(url)
        await expect(page.locator('output')).toHaveText('Unsaved')
      } else {
        await expect(page).toHaveURL(destination)
        await expect(page.locator('output')).toHaveText('Unchanged')
      }
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
    let nextTabId = await chrome.evaluate(async tabId => {
      let pane = await (window as any).bmux.command({ method: 'split-window', args: { pane: tabId } })
      return pane.id as string
    }, tabId)
    let choose = async (operation: () => Promise<unknown>, leave: boolean) => {
      let closing = operation()
      let prompt = chrome.getByRole('alertdialog', { name: 'Leave this site?' })
      await expect(prompt).toBeVisible()
      await prompt.getByRole('button', { name: leave ? 'Leave (enter)' : 'Stay (esc)', exact: true }).click()
      let result = await closing
      await expect(prompt).toHaveCount(0)
      return result
    }
    let closeTab = () => chrome.evaluate(({ tabId }) => (window as any).bmux.command({ method: 'kill-pane', args: { pane: tabId } }), { tabId })
    expect(await choose(closeTab, false)).toEqual({ cancelled: tabId })
    await expect(page.locator('output')).toHaveText('Unsaved')
    expect(await choose(closeTab, true)).toEqual({ closed: tabId })
    await expect.poll(() => application.context().pages().some(candidate => candidate.url() === url)).toBe(false)
    let windowId = await chrome.evaluate(async () => {
      let state = await (window as any).bmux.state()
      let current = state.model.sessions[0].windows[0]
      return current.id as string
    })
    await chrome.evaluate(({ nextTabId, url }) => (window as any).bmux.command({ method: 'navigate', args: { tab: nextTabId, url } }), { nextTabId, url })
    await expect.poll(() => application.context().pages().some(candidate => candidate.url() === url)).toBe(true)
    let replacement = application.context().pages().find(candidate => candidate.url() === url)!
    replacement.on('dialog', () => undefined)
    await replacement.getByRole('button', { name: 'Edit' }).click()
    let closeWindow = () => chrome.evaluate(({ windowId }) => (window as any).bmux.command({ method: 'kill-window', args: { window: windowId, confirm: true } }), { windowId })
    expect(await choose(closeWindow, false)).toEqual({ cancelled: windowId })
    await expect(replacement.locator('output')).toHaveText('Unsaved')
    expect(await choose(closeWindow, true)).toEqual({ closed: windowId })
    await expect.poll(() => application.context().pages().some(candidate => candidate.url() === url)).toBe(false)
  } finally { await cleanup() }
})

test('bmux reload and history actions use styled unsaved changes prompts', async () => {
  let { application, chrome, page, url, close } = await fixture()
  try {
    page.on('dialog', () => undefined)
    let tabId = await chrome.evaluate(async () => (await (window as any).bmux.state()).model.sessions[0].windows[0].panes[0].id as string)
    let next = `${url}?next`
    await chrome.evaluate(({ tabId, next }) => (window as any).bmux.command({ method: 'navigate', args: { tab: tabId, url: next } }), { tabId, next })
    await expect(page).toHaveURL(next)
    let index = await chrome.evaluate(async ({ tabId, url }) => (await (window as any).bmux.state()).navigation[tabId].entries.findIndex((entry: { url: string }) => entry.url === url), { tabId, url })
    for (let method of ['reload', 'hard-reload', 'back', 'forward', 'history.go-to']) {
      let current = page.url()
      await page.getByRole('button', { name: 'Edit' }).click()
      await expect(page.locator('output')).toHaveText('Unsaved')
      for (let keyCode of ['Escape', 'Enter']) {
        await chrome.evaluate(({ tabId, method, index }) => (window as any).bmux.command({ method, args: { tab: tabId, index } }), { tabId, method, index })
        let prompt = chrome.getByRole('alertdialog', { name: 'Leave this site?' })
        await expect(prompt).toBeVisible()
        await expect(prompt.getByRole('button', { name: 'Stay (esc)', exact: true })).toBeFocused()
        await sendNativeKeys(application, [{ keyCode }])
        await expect(prompt).toHaveCount(0)
        if (keyCode === 'Escape') {
          await expect(page).toHaveURL(current)
          await expect(page.locator('output')).toHaveText('Unsaved')
        } else {
          await expect(page).toHaveURL(method === 'back' || method === 'history.go-to' ? url : method === 'forward' ? next : current)
          await expect(page.locator('output')).toHaveText('Unchanged')
        }
      }
    }
  } finally { await close() }
})
