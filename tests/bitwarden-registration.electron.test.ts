import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { installBitwardenExtension } from '../src/main/bitwarden-extension'
import { closeTestApplication } from './electron-fixture'

test('official Bitwarden saves a new passkey in the chosen login and completes WebAuthn registration', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-passkey-registration-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><button id="register">Create passkey</button><output id="result"></output><script>
      document.querySelector('#register').onclick = async () => {
        let result = document.querySelector('#result')
        result.textContent = 'Waiting'
        try {
          let credential = await navigator.credentials.create({ publicKey: {
            challenge: new Uint8Array([1, 2, 3]), rp: { name: 'Local fixture', id: 'localhost' },
            user: { id: new Uint8Array([4, 5, 6]), name: 'fixture@example.test', displayName: 'Fixture login' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          } })
          let json = credential.toJSON()
          let client = JSON.parse(new TextDecoder().decode(credential.response.clientDataJSON))
          result.textContent = json.id === credential.id && json.response.attestationObject
            && client.type === 'webauthn.create' && client.challenge === 'AQID' && client.origin === location.origin
            ? 'Registered' : 'Invalid credential'
        } catch (error) { result.textContent = error.name + ': ' + error.message }
      }
    </script>`)
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let url = `http://localhost:${(server.address() as { port: number }).port}/`
    let extension = await installBitwardenExtension(directory)
    let background = path.join(extension, 'background.js')
    let source = await fs.readFile(background, 'utf8')
    let main = source.indexOf('const XF=new r(!1),ZF=self.bitwardenMain=new class')
    let bootstrap = 'ZF.bootstrap().catch(e=>XF.error(e))'
    expect(main).toBeGreaterThan(0)
    expect(source.split(bootstrap)).toHaveLength(2)
    // Keep the official WebAuthn client, authenticator, popout session and
    // content scripts. Substitute only account state and the remote vault.
    await fs.writeFile(background, source.slice(0, main) + `
      let auth = { getAuthStatus: async () => ad.Unlocked };
      let cipher = { reprompt: 0, login: { username: 'fixture@example.test' } };
      let vault = {
        ciphers$: () => Se({ 'fixture-login': { type: 1 } }),
        decrypt: async () => cipher,
        updateWithServer: async (item, userId) => {
          let credentials = item.login.fido2Credentials;
          let saved = credentials.length === 1 && credentials[0].rpId === 'localhost' && userId === 'fixture-user';
          await chrome.storage.local.set({ fixturePasskeySaved: saved });
        }
      };
      let log = { info() {}, warning() {}, error() {} };
      let account = { activeAccount$: Se({ id: 'fixture-user' }) };
      let sync = { activeUserLastSync$: () => Se(new Date()) };
      let tasks = { registerTaskHandler() {}, setTimeout() { return { unsubscribe() {} } } };
      let settings = { enablePasskeys$: Se(true) };
      let domains = { blockedInteractionsUris$: Se(null), neverDomains$: Se(null) };
      let config = { getFeatureFlag$: () => Se(false), serverConfig$: Se({}) };
      let manager = new Dk;
      let authenticator = new ES(vault, new mU(auth), sync, account, log);
      let client = new RS(authenticator, config, auth, settings, domains, tasks, manager, log);
      let fido2 = new lU(log, manager, client, settings, null, auth);
      chrome.runtime.onMessage.addListener(fido2.handleExtensionMessage);
    ` + source.slice(source.indexOf(bootstrap) + bootstrap.length))
    let manifest = path.join(extension, 'manifest.json')
    let data = JSON.parse(await fs.readFile(manifest, 'utf8'))
    data.action = { default_popup: 'probe.html' }
    data.content_scripts = [
      { matches: ['http://localhost/*'], js: ['content/fido2-page-script.js'], run_at: 'document_start', world: 'MAIN' },
      { matches: ['http://localhost/*'], js: ['content/fido2-content-script.js'], run_at: 'document_start' },
    ]
    await fs.writeFile(manifest, JSON.stringify(data))
    await fs.writeFile(path.join(extension, 'popup', 'index.html'), '<!doctype html><button hidden>Fixture login</button><script src="passkey-fixture.js"></script>')
    await fs.writeFile(path.join(extension, 'popup', 'passkey-fixture.js'), `
      let sessionId = new URLSearchParams(location.hash.split('?')[1]).get('sessionId')
      let send = (type, extra) => chrome.runtime.sendMessage({ command: 'BrowserFido2UserInterfaceServiceMessage', type, sessionId, ...extra }).catch(() => {})
      chrome.runtime.onMessage.addListener(message => {
        if (message.sessionId !== sessionId || message.type !== 'ConfirmNewCredentialRequest') return
        let button = document.querySelector('button')
        button.hidden = false
        button.onclick = () => send('ConfirmNewCredentialResponse', { cipherId: 'fixture-login', userVerified: message.userVerification })
      })
      void send('ConnectResponse')
    `)
    await fs.writeFile(path.join(extension, 'probe.html'), '<!doctype html><h1>Vault fixture</h1>')
    // Load the modified fixture as unpacked so package preparation cannot
    // rewrite the small test stand-in for Bitwarden's Angular popup.
    let fixture = path.join(directory, 'fixture-extension')
    await fs.rename(extension, fixture)
    let installed = process.env.BMUX_TEST_INSTALLED === '1'
    application = await electron.launch({ ...(installed ? { executablePath: path.resolve(process.env.BMUX_OUTPUT_DIR || 'build', 'bmux.app/Contents/MacOS/bmux') } : {}), args: installed ? [] : [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    let browser = application
    await expect.poll(() => browser.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = browser.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let descriptor = await chrome.evaluate(location => (window as any).bmux.command({ method: 'extension.load', args: { profile: 'profile_default', path: location } }), fixture)
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url)
    await address.press('Enter')
    await expect.poll(() => browser.context().pages().some(page => page.url() === url)).toBe(true)
    let page = browser.context().pages().find(page => page.url() === url)!
    await page.getByRole('button', { name: 'Create passkey' }).click()
    await expect.poll(() => browser.context().pages().some(page => page.url().includes('#/fido2?'))).toBe(true)
    let popup = browser.context().pages().find(page => page.url().includes('#/fido2?'))!
    await popup.getByRole('button', { name: 'Fixture login' }).click()
    await expect(page.locator('#result')).toHaveText('Registered')
    await expect.poll(() => popup.isClosed()).toBe(true)
    await chrome.evaluate(id => (window as any).bmux.command({ method: 'extension.open', args: { profile: 'profile_default', id } }), descriptor.id)
    await expect.poll(() => browser.context().pages().some(page => page.url().endsWith('/probe.html'))).toBe(true)
    let vault = browser.context().pages().find(page => page.url().endsWith('/probe.html'))!
    expect(await vault.evaluate(async () => (await (window as any).chrome.storage.local.get('fixturePasskeySaved')).fixturePasskeySaved)).toBe(true)
  } finally {
    await closeTestApplication(application)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
