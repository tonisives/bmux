import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { installBitwardenExtension } from '../src/main/bitwarden-extension'
import { closeTestApplication } from './electron-fixture'

test('Bitwarden inline menu coexists with Vim hints without interference warnings', async ({}, info) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-bitwarden-inline-'))
  // Exercise the pinned, unmodified content script without an account or vault.
  // Only the background responses and the request to display the menu are fixtures.
  let extension = await installBitwardenExtension(directory)
  let manifest = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'))
  manifest.content_scripts = [{ matches: ['http://127.0.0.1/*'], js: ['content/bootstrap-autofill-overlay.js', 'inline-fixture.js'], run_at: 'document_idle' }]
  await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest))
  await fs.writeFile(path.join(extension, 'background.js'), `
    let visible = false
    chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      if (message.command === 'updateAutofillInlineMenuElementIsVisibleStatus') visible = message.isVisible
      if (message.command === 'autofillOverlayElementClosed') visible = false
      respond(message.command === 'getUrlAutofillTargetingRules' ? { result: null } : message.command === 'checkIsAutofillInlineMenuButtonVisible' ? visible : false)
    })
  `)
  await fs.writeFile(path.join(extension, 'inline-fixture.js'), `
    ;(async () => {
      let init = window.bitwardenAutofillInit
      let collect = init.collectAutofillContentService.getPageDetails.bind(init.collectAutofillContentService), collections = 0
      init.collectAutofillContentService.getPageDetails = async (...args) => {
        let result = await collect(...args)
        document.documentElement.dataset.inlineCollections = String(++collections)
        return result
      }
      await init.collectAutofillContentService.getPageDetails()
      document.querySelector('#username').addEventListener('focus', async () => {
        await init.autofillInlineMenuContentService.messageHandlers.appendAutofillInlineMenuToDom({ message: { overlayElement: 'button' } })
        document.documentElement.dataset.inlineFixture = 'open'
      })
      document.documentElement.dataset.inlineFixture = 'ready'
    })()
  `)
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Local login</title><style>body{padding:80px;font:16px sans-serif}input{display:block;width:400px;height:40px;margin:20px}</style><label>Username<input id="username" autocomplete="username"></label><label>Password<input id="password" type="password" autocomplete="current-password"></label><output id="layout-state"></output>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/login`
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  adblock: false\n  autoUpdateFilters: false\n')
  let application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    await chrome.evaluate(location => (window as any).bmux.command({ method: 'extension.load', args: { profile: 'profile_default', path: location } }), extension)
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url); await address.press('Enter')
    await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    let warnings: string[] = []
    page.on('dialog', async dialog => { warnings.push(dialog.message()); await dialog.dismiss() })
    await expect(page.locator('html')).toHaveAttribute('data-inline-fixture', 'ready')
    await expect(page.locator('[data-bmux-vim-hints] button')).toHaveCount(1)
    await page.locator('#username').click()
    await expect(page.locator('html')).toHaveAttribute('data-inline-fixture', 'open')
    // Each page update causes Bitwarden to collect the fields again. A passive
    // hint must not make those collections exhaust its top-layer safety limit.
    for (let change = 0; change < 8; change++) {
      let collections = Number(await page.locator('html').getAttribute('data-inline-collections'))
      await page.locator('#layout-state').evaluate((output, change) => { output.textContent = String(change) }, change)
      await expect.poll(async () => Number(await page.locator('html').getAttribute('data-inline-collections'))).toBeGreaterThan(collections)
    }
    await page.locator('#username').pressSequentially('fixture-user')
    await expect(page.locator('[data-bmux-vim-hints] button')).toBeVisible()
    expect(warnings).toEqual([])
    await expect(page.locator(':popover-open')).toHaveCount(1)
    await page.screenshot({ path: info.outputPath('bitwarden-inline-hints.png') })
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
