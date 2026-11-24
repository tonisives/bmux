import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { initialModel } from '../src/main/model'
import { closeTestApplication } from './electron-fixture'

type CaptureResult = { tracks?: string[]; error?: string }
type FixtureWindow = Window & { capture?: CaptureResult; previewTrack?: MediaStreamTrack }

let requestCapture = (page: Page, constraints: MediaStreamConstraints) => page.evaluate(constraints => {
  let fixture = window as FixtureWindow
  delete fixture.capture
  void navigator.mediaDevices.getUserMedia(constraints).then(stream => {
    let tracks = stream.getTracks()
    fixture.capture = { tracks: tracks.map(track => track.kind).sort() }
    tracks.forEach(track => track.stop())
  }, (error: DOMException) => { fixture.capture = { error: error.name } })
}, constraints)

let captureResult = (page: Page) => page.evaluate(() => (window as FixtureWindow).capture)

test('video calls test devices and grant camera and microphone independently', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-video-calls-'))
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>Video call fixture</title><h1>Video call fixture</h1>')
  })
  let application: ElectronApplication | undefined
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    let target = `${origin}/call`, otherPage = `${origin}/later`
    let model = initialModel(), profile = model.profiles[0], pane = model.sessions[0].windows[0].panes[0]
    await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify(model))
    let config = path.join(directory, 'config.yaml')
    await fs.writeFile(config, 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
    application = await electron.launch({
      args: [process.cwd(), '--use-fake-device-for-media-stream'],
      env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: config, BMUX_BACKGROUND: '0' },
    })
    let browserPage = async (url: string | RegExp) => {
      let matches = (page: Page) => typeof url === 'string' ? page.url() === url : url.test(page.url())
      await expect.poll(() => application!.context().pages().some(matches)).toBe(true)
      return application!.context().pages().find(matches)!
    }
    let chrome = await browserPage(/\/renderer\/index\.html$/)
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(target); await address.press('Enter')
    let page = await browserPage(target)
    await expect(page.getByRole('heading')).toHaveText('Video call fixture')
    let notice = (text: string) => chrome.getByLabel('Notifications').getByRole('status').filter({ hasText: text })

    await requestCapture(page, { video: true })
    let camera = notice('requests camera access')
    await expect(camera).toContainText(origin)
    await camera.getByRole('button', { name: 'Test camera', exact: true }).click()
    let preview = camera.getByLabel('Camera preview', { exact: true })
    await expect.poll(() => preview.evaluate(video => (video as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
    await preview.evaluate(video => {
      (window as FixtureWindow).previewTrack = ((video as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]
    })
    expect(await captureResult(page)).toBeUndefined()
    await camera.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect.poll(() => captureResult(page)).toEqual({ tracks: ['video'] })
    await expect(camera).toHaveCount(0)
    await expect.poll(() => chrome.evaluate(() => (window as FixtureWindow).previewTrack?.readyState)).toBe('ended')
    let grants = async () => JSON.parse(await fs.readFile(path.join(directory, 'permissions.json'), 'utf8'))
    expect(await grants()).toEqual([[`${profile.id}|${origin}|media:video`, true]])

    await requestCapture(page, { video: true, audio: true })
    let microphone = notice('requests microphone access')
    await microphone.getByRole('button', { name: 'Test microphone', exact: true }).click()
    let meter = microphone.getByRole('meter', { name: 'Microphone level' })
    await expect(microphone.getByText('Speak to check your level.')).toBeVisible()
    await expect.poll(() => meter.evaluate(element => (element as HTMLMeterElement).value), { timeout: 10_000 }).toBeGreaterThan(0)
    await microphone.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect.poll(() => captureResult(page)).toEqual({ tracks: ['audio', 'video'] })
    expect(await grants()).toContainEqual([`${profile.id}|${origin}|media:audio`, true])

    await rpc('navigate', { pane: pane.id, url: otherPage })
    page = await browserPage(otherPage)
    await expect(page.getByRole('heading')).toHaveText('Video call fixture')
    await requestCapture(page, { video: true, audio: true })
    await expect.poll(() => captureResult(page)).toEqual({ tracks: ['audio', 'video'] })
    expect(await rpc('permission.list')).toEqual([])

    await chrome.getByRole('button', { name: /^Site information:/ }).click()
    let reset = chrome.getByRole('dialog', { name: 'Site information', exact: true }).getByRole('button', { name: 'Reset camera and mic permissions and reload', exact: true })
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), reset.click()])
    await chrome.keyboard.press('Escape')
    expect(await grants()).toEqual([])
    await requestCapture(page, { video: true, audio: true })
    let both = notice('requests camera and microphone access')
    await both.getByRole('button', { name: 'Deny', exact: true }).click()
    await expect.poll(() => captureResult(page)).toEqual({ error: 'NotAllowedError' })
    await requestCapture(page, { audio: true })
    await expect.poll(() => captureResult(page)).toEqual({ error: 'NotAllowedError' })
    expect(await rpc('permission.list')).toEqual([])
  } finally {
    await closeTestApplication(application)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
