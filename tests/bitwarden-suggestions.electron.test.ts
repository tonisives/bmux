import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { installBitwardenExtension } from '../src/main/bitwarden-extension'
import { closeTestApplication } from './electron-fixture'

test('official Bitwarden suggestion probes reproduce terminal update errors and stale empty menus', async ({}, info) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-suggestion-probe-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    let installed = await installBitwardenExtension(directory)
    let extension = path.join(directory, 'fixture-extension')
    await fs.rename(installed, extension)
    let background = path.join(extension, 'background.js')
    let source = await fs.readFile(background, 'utf8')
    let bootstrap = 'ZF.bootstrap().catch(e=>XF.error(e))'
    expect(source.split(bootstrap)).toHaveLength(2)
    let fixture = await fs.readFile(path.resolve('tests/fixtures/bitwarden-suggestions.js'), 'utf8')
    expect(source).toContain('this.overlayBackground=new MN(')
    let main = source.indexOf('const XF=new r(!1),ZF=self.bitwardenMain=new class')
    expect(main).toBeGreaterThan(0)
    let workerImport = 'importScripts(o.p+o.u(t))'
    expect(source.split(workerImport)).toHaveLength(2)
    let pageImport = 'i.push(new Promise((resolve,reject)=>{let script=document.createElement("script");script.src=o.p+o.u(t);script.onload=resolve;script.onerror=reject;document.head.append(script)}))'
    // Retain the official overlay class and bundled RxJS, replacing account
    // startup and unrelated application services with the probe entry point.
    await fs.writeFile(background, (source.slice(0, main) + `self.bmuxProbeOverlay=MN;(()=>{${fixture}})()` + source.slice(source.indexOf(bootstrap) + bootstrap.length)).replace(workerImport, pageImport))
    let manifestFile = path.join(extension, 'manifest.json')
    let manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
    // Execute the pinned bundle in a disposable extension page. The original
    // overlay methods and RxJS subscriptions need no worker lifecycle APIs.
    delete manifest.background
    manifest.action.default_popup = 'suggestion-probe.html'
    await fs.writeFile(manifestFile, JSON.stringify(manifest))
    await fs.writeFile(path.join(extension, 'suggestion-probe.html'), '<!doctype html><title>Suggestion probe</title><h1>Suggestion probe</h1><script src="background.js"></script>')
    await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  adblock: false\n  autoUpdateFilters: false\n')
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let errors: string[] = []
    application.context().on('page', page => page.on('pageerror', error => errors.push(error.message)))
    let installedExtension = await chrome.evaluate(location => (window as any).bmux.command({ method: 'extension.load', args: { profile: 'profile_default', path: location } }), extension)
    await chrome.evaluate(id => (window as any).bmux.command({ method: 'extension.open', args: { profile: 'profile_default', id } }), installedExtension.id)
    await expect.poll(() => application!.context().pages().some(page => page.url().startsWith('chrome-extension://'))).toBe(true)
    let popup = application.context().pages().find(page => page.url().startsWith('chrome-extension://'))!
    await expect(popup.getByRole('heading', { name: 'Suggestion probe' })).toBeVisible()
    // Read the fixture promise directly, without extension message arbitration.
    await expect.poll(async () => {
      if (errors.length) throw new Error(errors.join('\n'))
      return popup.evaluate(() => typeof (self as any).bmuxSuggestionProbe)
    }).toBe('object')
    let probe = await popup.evaluate(() => (self as any).bmuxSuggestionProbe)
    await info.attach('suggestion-probe.json', { body: JSON.stringify(probe, null, 2), contentType: 'application/json' })
    expect(probe).toEqual({ result: {
      healthy: { subscribed: true, items: ['fixture-login'] },
      afterFailure: { subscribed: false, callsAfterFailure: 2, callsAfterMoreUpdates: 2, cachedItems: 0, publications: 1 },
      reinitialized: ['fixture-recovered'],
      race: { builds: [[], ['fixture-current']], sent: [['fixture-current'], []], subscribed: true },
    } })
  } finally {
    if (application) await closeTestApplication(application)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
