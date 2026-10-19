import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { bitwardenTargetingRules, installBitwardenExtension } from '../src/main/bitwarden-extension'
import { closeTestApplication } from './electron-fixture'

for (let release of ['2026.6.1', '2026.10.0']) for (let stalledFrame of [false, true]) test(`Bitwarden ${release} inline menu coexists with Vim hints without interference warnings${stalledFrame ? ' in a cross-origin frame with stalled unlocked targeting' : ''}`, async ({}, info) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-bitwarden-inline-'))
  // Exercise the pinned, unmodified content script without an account or vault.
  // Only the background responses and the request to display the menu are fixtures.
  let installed = await installBitwardenExtension(directory, undefined, release)
  // This fixture replaces the worker, so it is an unpacked test extension rather
  // than a managed official package eligible for background compatibility patches.
  let extension = path.join(directory, 'fixture-extension')
  await fs.rename(installed, extension)
  let manifest = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'))
  manifest.content_scripts = [{ matches: ['http://*/*'], all_frames: true, js: ['content/bootstrap-autofill-overlay.js', 'inline-fixture.js'], run_at: 'document_idle' }]
  await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest))
  await fs.writeFile(path.join(extension, 'background.js'), `
    let visible = false
    chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      if (message.command === 'getUrlAutofillTargetingRules') {
        (${bitwardenTargetingRules.toString()})({ authStatus: async () => 2, unlockedStatus: 2, lookup: () => ${stalledFrame ? 'new Promise(() => undefined)' : 'Promise.resolve(null)'} }).then(result => respond({ result }))
        return true
      }
      if (message.command === 'fixtureAppendInline') {
        chrome.tabs.sendMessage(_sender.tab.id, { command: 'appendAutofillInlineMenuToDom', overlayElement: 'button' }).then(() => respond({ ok: true })).catch(error => respond({ error: String(error) }))
        return true
      }
      if (message.command === 'updateAutofillInlineMenuElementIsVisibleStatus') visible = message.isVisible
      if (message.command === 'autofillOverlayElementClosed') visible = false
      respond(message.command === 'checkIsAutofillInlineMenuButtonVisible' ? visible : false)
    })
  `)
  await fs.writeFile(path.join(extension, 'inline-fixture.js'), `
    ;(async () => {
      if (!document.querySelector('#username')) return
      let init = window.bitwardenAutofillInit
      let collect = init.collectAutofillContentService.getPageDetails.bind(init.collectAutofillContentService), collections = 0
      init.collectAutofillContentService.getPageDetails = async (...args) => {
        let result = await collect(...args)
        document.documentElement.dataset.inlineCollections = String(++collections)
        return result
      }
      await init.collectAutofillContentService.getPageDetails()
      document.querySelector('#username').addEventListener('input', () => { void init.collectAutofillContentService.getPageDetails() })
      document.querySelector('#username').addEventListener('focus', async () => {
        document.documentElement.dataset.inlineFocus = 'true'
        try {
          if (init.autofillInlineMenuContentService) await init.autofillInlineMenuContentService.messageHandlers.appendAutofillInlineMenuToDom({ message: { overlayElement: 'button' } })
          else {
            let reply = await chrome.runtime.sendMessage({ command: 'fixtureAppendInline' })
            if (reply?.error) throw new Error(reply.error)
          }
          document.documentElement.dataset.inlineFixture = 'open'
        } catch (error) { document.documentElement.dataset.inlineError = String(error) }
      })
      document.documentElement.dataset.inlineFixture = 'ready'
    })()
  `)
  let server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    if (stalledFrame && request.url === '/login') {
      response.end(`<title>Framed login</title><iframe title="Apple-style sign-in" style="width:100%;height:700px;border:0" src="http://localhost:${(server.address() as { port: number }).port}/fields"></iframe>`)
      return
    }
    response.end('<!doctype html><title>Local login</title><style>body{padding:80px;font:16px sans-serif}input{display:block;width:400px;height:40px;margin:20px}</style><label>Username<input id="username" autocomplete="username"></label><label>Password<input id="password" type="password" autocomplete="current-password"></label><output id="layout-state"></output>')
  })
  await new Promise<void>(resolve => server.listen(0, resolve))
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
    await expect.poll(() => !stalledFrame || page.frames().some(frame => frame.url().includes('/fields'))).toBe(true)
    let fields = stalledFrame ? page.frames().find(frame => frame.url().includes('/fields'))! : page
    let warnings: string[] = []
    page.on('dialog', async dialog => { warnings.push(dialog.message()); await dialog.dismiss() })
    await expect(fields.locator('html')).toHaveAttribute('data-inline-fixture', 'ready')
    await expect(fields.locator('[data-bmux-vim-hints] button')).toHaveCount(1)
    await fields.locator('#username').click()
    await expect.poll(() => fields.locator('html').evaluate(html => ({ state: html.dataset.inlineFixture, error: html.dataset.inlineError || null, focused: html.dataset.inlineFocus || null }))).toEqual({ state: 'open', error: null, focused: 'true' })
    // Each page update causes Bitwarden to collect the fields again. A passive
    // hint must not make those collections exhaust its top-layer safety limit.
    for (let change = 0; change < 8; change++) {
      let collections = Number(await fields.locator('html').getAttribute('data-inline-collections'))
      await fields.locator('#layout-state').evaluate((output, change) => { output.textContent = String(change) }, change)
      await fields.locator('#username').pressSequentially(String(change))
      await expect.poll(async () => Number(await fields.locator('html').getAttribute('data-inline-collections'))).toBeGreaterThan(collections)
    }
    await fields.locator('#username').pressSequentially('fixture-user')
    await expect(fields.locator('[data-bmux-vim-hints] button')).toBeVisible()
    expect(warnings).toEqual([])
    await expect(page.locator(':popover-open')).toHaveCount(1)
    await page.screenshot({ path: info.outputPath('bitwarden-inline-hints.png') })
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
