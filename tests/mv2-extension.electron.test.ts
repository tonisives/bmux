import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { closeTestApplication } from './electron-fixture'

test('a Manifest V2 popup can restore settings and resize the selected page', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-mv2-extension-'))
  let extensionPath = path.join(directory, 'extension')
  await fs.mkdir(extensionPath)
  await fs.writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify({
    manifest_version: 2, name: 'Thai font fixture', version: '1.0', permissions: ['activeTab', 'storage', 'http://127.0.0.1/*'],
    background: { scripts: ['background.js'], persistent: false },
    browser_action: { default_popup: 'popup.html' },
  }))
  await fs.writeFile(path.join(extensionPath, 'background.js'), 'chrome.commands.onCommand.addListener(() => {})')
  await fs.writeFile(path.join(extensionPath, 'popup.html'), '<!doctype html><h1>Thai font fixture</h1><p id="status"></p><script src="popup.js"></script>')
  await fs.writeFile(path.join(extensionPath, 'popup.js'), `
    let status = document.querySelector('#status')
    chrome.storage.local.get(['language', 'minFontSize'], settings => {
      settings.language ||= 'thai'
      settings.minFontSize ||= 18
      chrome.storage.local.set(settings)
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        let tab = tabs[0]
        if (!tab?.url) { status.textContent = 'Missing active tab URL'; return }
        window.activeTabUrl = tab.url
        chrome.tabs.sendMessage(tab.id, settings, { frameId: 0 }, () => {
          if (!chrome.runtime.lastError) { status.textContent = 'Missing receiver error was lost'; return }
          chrome.tabs.executeScript(tab.id, { file: 'content.js' }, () => {
            if (chrome.runtime.lastError) { status.textContent = chrome.runtime.lastError.message; return }
            chrome.tabs.sendMessage(tab.id, settings, { frameId: 0 }, response => {
              status.textContent = chrome.runtime.lastError?.message || response?.status || 'No response'
            })
          })
        })
      })
    })
  `)
  await fs.writeFile(path.join(extensionPath, 'content.js'), `
    chrome.runtime.onMessage.addListener((settings, _sender, reply) => {
      if (settings.language !== 'thai') return
      for (let element of document.querySelectorAll('p')) {
        if (/[\\u0e00-\\u0e7f]/.test(element.textContent)) element.style.fontSize = settings.minFontSize + 'px'
      }
      reply({ status: 'Resized Thai text' })
    })
  `)
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><style>p { font-size: 13px }</style><p id="thai">สวัสดี</p><p id="english">Hello</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/thai`
  let application: ElectronApplication | undefined
  try {
    let packaged = process.env.BMUX_TEST_INSTALLED === '1'
    application = await electron.launch({ ...(packaged ? { executablePath: path.resolve(process.env.BMUX_OUTPUT_DIR || 'build', 'bmux.app/Contents/MacOS/bmux') } : {}), args: packaged ? [] : [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let installed = await rpc('extension.load', { profile: 'profile_default', path: extensionPath })
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url)
    await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await expect(page.locator('#thai')).toBeVisible()
    await expect(page.locator('#thai')).toHaveCSS('font-size', '13px')
    await chrome.getByRole('button', { name: 'Extensions', exact: true }).click()
    await chrome.getByRole('dialog', { name: 'Extensions', exact: true }).getByRole('button', { name: 'Thai font fixture', exact: true }).click()
    await chrome.getByRole('region', { name: 'Extension details', exact: true }).getByRole('button', { name: 'Open extension', exact: true }).click()
    let popupUrl = `chrome-extension://${installed.id}/popup.html`
    await expect.poll(() => application!.context().pages().some(page => page.url() === popupUrl)).toBe(true)
    let popup = application.context().pages().find(page => page.url() === popupUrl)!
    await expect(popup.locator('#status')).toHaveText('Resized Thai text')
    expect(await popup.evaluate(() => (window as any).activeTabUrl)).toBe(url)
    await expect(page.locator('#thai')).toHaveCSS('font-size', '18px')
    await expect(page.locator('#english')).toHaveCSS('font-size', '13px')
    expect(await popup.evaluate(() => ['require', 'bmux'].map(key => typeof (window as any)[key]))).toEqual(['undefined', 'undefined'])
    expect(await popup.evaluate(() => (window as any).chrome.extension.getURL('content.js'))).toBe(`chrome-extension://${installed.id}/content.js`)
    expect(await popup.evaluate(() => (window as any).chrome.runtime.lastError)).toBeUndefined()
    await popup.close()
    await page.reload()
    await expect(page.locator('#thai')).toHaveCSS('font-size', '13px')
    await rpc('extension.open', { profile: 'profile_default', id: installed.id })
    await expect.poll(() => application!.context().pages().some(page => page.url() === popupUrl)).toBe(true)
    popup = application.context().pages().find(page => page.url() === popupUrl)!
    await expect(popup.locator('#status')).toHaveText('Resized Thai text')
    expect(await popup.evaluate(() => new Promise(resolve => (window as any).chrome.storage.local.get(['language', 'minFontSize'], resolve)))).toEqual({ language: 'thai', minFontSize: 18 })
    await expect(page.locator('#thai')).toHaveCSS('font-size', '18px')
    await popup.close()
    await page.goto(url.replace('127.0.0.1', 'localhost'))
    await rpc('extension.open', { profile: 'profile_default', id: installed.id })
    await expect.poll(() => application!.context().pages().some(page => page.url() === popupUrl)).toBe(true)
    popup = application.context().pages().find(page => page.url() === popupUrl)!
    await expect(popup.locator('#status')).toContainText('Extension manifest must request permission')
    await expect(page.locator('#thai')).toHaveCSS('font-size', '13px')
  } finally {
    await closeTestApplication(application)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
