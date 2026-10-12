import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { patchBitwardenPasskeys } from '../src/main/bitwarden-extension'
import { closeTestApplication } from './electron-fixture'

test('locked Bitwarden passkey startup opens unlock and releases sign-in without background popups', async ({}, testInfo) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-passkey-'))
  let extensionPath = path.join(directory, 'extension')
  await fs.mkdir(extensionPath)
  await fs.writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'Passkey fixture', version: '1.0', permissions: ['tabs', 'storage'],
    background: { service_worker: 'background.js' },
    content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_start' }],
  }))
  await fs.writeFile(path.join(extensionPath, 'background.js'), `
    let ad = { Unlocked: 2 }, oN = 'auth_unlockExtension'
    let YO = { focusTab: async () => undefined, focusWindow: async () => undefined }
    let aN = { openPopout: async () => {
      let { failOpen = false } = await chrome.storage.local.get('failOpen')
      if (failOpen) throw new Error('fixture window failure')
      return chrome.windows.create({ url: chrome.runtime.getURL('unlock.html'), type: 'popup', focused: true })
    } }
    let background = { authService: { getAuthStatus: async () => {
      let { unlocked = false } = await chrome.storage.local.get('unlocked')
      return unlocked ? 2 : 1
    } } }
    let handle = function* (n,t,e,i) { ${patchBitwardenPasskeys('try{return yield i(n,t,e)}finally{null!=t.id&&(yield YO.focusTab(t.id)),null!=t.windowId&&(yield YO.focusWindow(t.windowId))}')} }
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (message.command !== 'passkey') return
      ;(async () => {
        try {
          if (message.options.failOpen) await chrome.storage.local.set({ unlocked: false, failOpen: true })
          let iterator = handle.call(background, message.options, sender.tab, {}, async (_request, tab) => ({ credential: { id: 'fixture-credential' }, windowId: tab.windowId }))
          let step = iterator.next()
          while (!step.done) {
            let value
            try { value = await step.value }
            catch (error) { step = iterator.throw(error); continue }
            step = iterator.next(value)
            }
          respond(step.value)
        } catch (error) { respond({ error: { name: error.name, message: error.message } }) }
      })()
      return true
    })
  `)
  await fs.writeFile(path.join(extensionPath, 'content.js'), `
    window.addEventListener('message', event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.command !== 'passkey' || !event.ports[0]) return
      chrome.runtime.sendMessage(event.data, response => event.ports[0].postMessage(response))
    })
    document.documentElement.dataset.passkeyFixture = 'ready'
  `)
  await fs.writeFile(path.join(extensionPath, 'unlock.html'), '<!doctype html><h1>Unlock Bitwarden fixture</h1><button id="unlock">Unlock fixture</button><script src="unlock.js"></script>')
  await fs.writeFile(path.join(extensionPath, 'unlock.js'), 'document.querySelector("#unlock").onclick = async () => { await chrome.storage.local.set({ unlocked: true }); document.body.dataset.unlocked = "true" }')
  let server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    if (request.url === '/signin') { response.end('<!doctype html><h1>Normal sign-in</h1>'); return }
    response.end(`<!doctype html><h1>Passkey sign-in</h1><button id="signin">Sign in</button><p id="status"></p><a href="/signin">Use normal sign-in</a><script>
      navigator.credentials.get = options => new Promise((resolve, reject) => {
        let channel = new MessageChannel()
        channel.port1.onmessage = ({data}) => { channel.port1.close(); data.error ? reject(new DOMException(data.error.message, data.error.name)) : resolve(data.credential) }
        window.postMessage({ command: 'passkey', options: { mediation: options?.mediation, failOpen: options?.failOpen } }, location.origin, [channel.port2])
      })
      document.querySelector('#signin').onclick = async () => {
        let status = document.querySelector('#status'); status.textContent = 'Waiting'
        try { let result = await navigator.credentials.get({publicKey: {challenge: new Uint8Array([1])}}); status.textContent = result.id }
        catch (error) { status.textContent = error.name + ': ' + error.message }
      }
    </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  let installed = process.env.BMUX_TEST_INSTALLED === '1'
  let application = await electron.launch({ ...(installed ? { executablePath: path.resolve(process.env.BMUX_OUTPUT_DIR || 'build', 'bmux.app/Contents/MacOS/bmux') } : {}), args: installed ? [] : [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    await chrome.evaluate(location => (window as any).bmux.command({ method: 'extension.load', args: { profile: 'profile_default', path: location } }), extensionPath)
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url); await address.press('Enter')
    await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await expect(page.locator('html')).toHaveAttribute('data-passkey-fixture', 'ready')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.locator('#status')).toHaveText('NotAllowedError: Unlock Bitwarden and try passkey sign-in again.')
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/unlock.html'))).toBe(true)
    let popup = application.context().pages().find(page => page.url().endsWith('/unlock.html'))!
    await expect(popup.getByRole('heading')).toHaveText('Unlock Bitwarden fixture')
    await expect.poll(() => application.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)?.isFocused(), popup.url())).toBe(true)
    await popup.screenshot({ path: testInfo.outputPath('passkey-unlock.png') })
    await popup.close()
    expect(await page.evaluate(async () => Promise.all([1, 2].map(async () => {
      try { await navigator.credentials.get({ publicKey: { challenge: new Uint8Array([1]) } }); return 'resolved' }
      catch (error) { return (error as DOMException).name }
    })))).toEqual(['NotAllowedError', 'NotAllowedError'])
    expect(application.context().pages().filter(page => page.url().endsWith('/unlock.html'))).toHaveLength(1)
    popup = application.context().pages().find(page => page.url().endsWith('/unlock.html'))!
    await popup.close()
    expect(await page.evaluate(async () => {
      try { await navigator.credentials.get({ mediation: 'conditional', publicKey: { challenge: new Uint8Array([1]) } }); return 'resolved' }
      catch (error) { return (error as DOMException).name }
    })).toBe('NotAllowedError')
    expect(application.context().pages().filter(page => page.url().endsWith('/unlock.html'))).toHaveLength(0)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/unlock.html'))).toBe(true)
    popup = application.context().pages().find(page => page.url().endsWith('/unlock.html'))!
    await popup.getByRole('button', { name: 'Unlock fixture' }).click()
    await expect(popup.locator('body')).toHaveAttribute('data-unlocked', 'true')
    await popup.close()
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.locator('#status')).toHaveText('fixture-credential')
    expect(await page.evaluate(async () => {
      try { await (navigator.credentials as any).get({ failOpen: true }); return 'resolved' }
      catch (error) { return { name: (error as DOMException).name, message: (error as DOMException).message } }
    })).toEqual({ name: 'NotAllowedError', message: 'Bitwarden could not open its unlock window. Open the extension and try again.' })
    await page.getByRole('link', { name: 'Use normal sign-in' }).click()
    await expect(page.getByRole('heading')).toHaveText('Normal sign-in')
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
