import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Frame, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { initialModel } from '../src/main/model'
import { closeTestApplication } from './electron-fixture'

type CaptureResult = { tracks?: string[]; error?: string }
type FixtureWindow = Window & { capture?: CaptureResult; previewTrack?: MediaStreamTrack; microphoneTrack?: MediaStreamTrack; preflight?: PermissionState; preflightClicks?: number }

let requestCapture = (page: Page | Frame, constraints: MediaStreamConstraints) => page.evaluate(constraints => {
  let fixture = window as FixtureWindow
  delete fixture.capture
  void navigator.mediaDevices.getUserMedia(constraints).then(stream => {
    let tracks = stream.getTracks()
    fixture.capture = { tracks: tracks.map(track => track.kind).sort() }
    tracks.forEach(track => track.stop())
  }, (error: DOMException) => { fixture.capture = { error: error.name } })
}, constraints)

let captureResult = (page: Page | Frame) => page.evaluate(() => (window as FixtureWindow).capture)

test('video calls test devices and grant camera and microphone independently', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-video-calls-'))
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(`<!doctype html><title>Video call fixture</title><h1>Video call fixture</h1>
      <button id="camera">Turn on camera</button><button id="microphone">Turn on microphone</button><button id="preflight">Allow camera</button>
      <button class="ordinary">Open issue</button><button class="ordinary">Start watching Camera Obscura</button><output></output>
      <script>
        async function turnOn(constraints) {
          delete window.capture
          try {
            let stream = await navigator.mediaDevices.getUserMedia(constraints)
            window.capture = { tracks: stream.getTracks().map(track => track.kind) }
            stream.getTracks().forEach(track => track.stop())
          } catch (error) { window.capture = { error: error.name } }
        }
        document.querySelector('#camera').onclick = () => turnOn({ video: true })
        document.querySelector('#microphone').onclick = () => turnOn({ audio: true })
        let queryCamera = () => navigator.permissions.query({ name: 'camera' }).then(result => result.state)
        let cachedCameraState = queryCamera()
        for (let button of document.querySelectorAll('.ordinary')) button.onclick = async () => {
          await Promise.all([queryCamera(), navigator.permissions.query({ name: 'microphone' })])
          let output = document.querySelector('output')
          output.dataset.probedAt = String(performance.now())
          output.textContent = button.textContent
        }
        document.querySelector('#preflight').onclick = async () => {
          delete window.capture
          window.preflightClicks = (window.preflightClicks || 0) + 1
          window.preflight = await (window.preflightClicks === 1 ? cachedCameraState : queryCamera())
          if (window.preflight === 'granted') await turnOn({ video: true })
        }
      </script>`)
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
      args: [process.cwd(), '--use-fake-device-for-media-stream=device-count=2'],
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
    let prompt = (devices: string) => chrome.getByRole('dialog', { name: `Allow ${devices} access?`, exact: true })
    let permissionStates = () => page.evaluate(() => Promise.all(['camera', 'microphone'].map(async name =>
      (await navigator.permissions.query({ name: name as PermissionName })).state)))
    expect(await permissionStates()).toEqual(['denied', 'denied'])
    expect(await rpc('permission.list')).toEqual([])

    let siteInfo = chrome.getByRole('button', { name: /^Site information:/ })
    let information = chrome.getByRole('dialog', { name: 'Site information', exact: true })
    let permissions = chrome.getByRole('dialog', { name: 'Permissions', exact: true })
    let openPermissions = async () => {
      await siteInfo.click()
      await information.getByRole('button', { name: 'Permissions', exact: true }).click()
    }
    let camera = prompt('camera')
    await openPermissions()
    await expect(permissions).toContainText(origin)
    let cameraRow = permissions.getByRole('button', { name: 'Camera Ask', exact: true })
    await cameraRow.click()
    let inlineCamera = permissions.getByLabel('Camera preview', { exact: true })
    await expect.poll(() => inlineCamera.evaluate(video => (video as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
    await expect(permissions.getByRole('combobox', { name: 'Camera', exact: true }).locator('option')).toHaveCount(3)
    await inlineCamera.evaluate(video => { (window as FixtureWindow).previewTrack = ((video as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0] })
    await permissions.getByRole('button', { name: 'Microphone Ask', exact: true }).click()
    await expect.poll(() => chrome.evaluate(() => (window as FixtureWindow).previewTrack?.readyState)).toBe('ended')
    await expect.poll(() => permissions.getByRole('meter', { name: 'Microphone level' }).evaluate(element => (element as HTMLMeterElement).value)).toBeGreaterThan(0)
    await expect(permissions.locator('button[aria-expanded] svg').first()).toBeVisible()
    await chrome.screenshot({ path: 'artifacts/site-permissions.png' })
    await permissions.getByRole('button', { name: 'Back', exact: true }).click()
    await information.getByRole('button', { name: 'Close', exact: true }).click()
    expect(await permissionStates()).toEqual(['denied', 'denied'])

    await page.getByRole('button', { name: 'Turn on camera', exact: true }).click()
    await expect(camera).toContainText(origin)
    await camera.getByRole('button', { name: 'Test camera', exact: true }).click()
    let preview = camera.getByLabel('Camera preview', { exact: true })
    await expect.poll(() => preview.evaluate(video => (video as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
    let initialCameraId = await preview.evaluate(video => {
      let fixture = window as FixtureWindow
      let track = ((video as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]
      fixture.previewTrack = track
      return track.getSettings().deviceId
    })
    let cameraInput = camera.getByRole('combobox', { name: 'Camera', exact: true })
    await expect(cameraInput.locator('option')).toHaveCount(3)
    let alternateCamera = await cameraInput.evaluate((input, initialId) =>
      [...(input as HTMLSelectElement).options].find(option => option.value && option.value !== initialId)!.value, initialCameraId)
    await cameraInput.selectOption(alternateCamera)
    await expect.poll(() => preview.evaluate(video => ((video as HTMLVideoElement).srcObject as MediaStream | null)?.getVideoTracks()[0].getSettings().deviceId)).toBe(alternateCamera)
    await expect.poll(() => chrome.evaluate(() => (window as FixtureWindow).previewTrack?.readyState)).toBe('ended')
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

    await chrome.evaluate(() => {
      let media = navigator.mediaDevices
      let capture = media.getUserMedia.bind(media)
      media.getUserMedia = async constraints => {
        let stream = await capture(constraints)
        let microphone = stream.getAudioTracks()[0]
        if (microphone) (window as FixtureWindow).microphoneTrack = microphone
        return stream
      }
    })
    await requestCapture(page, { video: true, audio: true })
    let microphone = prompt('microphone')
    await microphone.getByRole('button', { name: 'Test microphone', exact: true }).click()
    let meter = microphone.getByRole('meter', { name: 'Microphone level' })
    let microphoneInput = microphone.getByRole('combobox', { name: 'Microphone', exact: true })
    let alternateMicrophone = await microphoneInput.selectOption({ label: 'Fake Audio Input 2' })
    await expect.poll(() => chrome.evaluate(() => (window as FixtureWindow).microphoneTrack?.getSettings().deviceId)).toBe(alternateMicrophone[0])
    await expect(microphone.getByText('Speak to check your level.')).toBeVisible()
    await expect.poll(() => meter.evaluate(element => (element as HTMLMeterElement).value), { timeout: 10_000 }).toBeGreaterThan(0)
    if (process.platform === 'darwin') {
      await application.evaluate(({ app, systemPreferences }) => {
        let hasSwitch = app.commandLine.hasSwitch.bind(app.commandLine)
        app.commandLine.hasSwitch = name => name !== 'use-fake-device-for-media-stream' && hasSwitch(name)
        systemPreferences.getMediaAccessStatus = type => type === 'microphone' ? 'denied' : 'granted'
      })
      await microphone.getByRole('button', { name: 'Allow', exact: true }).click()
      await expect(microphone.getByRole('alert')).toHaveText('Allow microphone access for bmux in System Settings → Privacy & Security.')
      expect(await captureResult(page)).toBeUndefined()
      expect(await grants()).toEqual([[`${profile.id}|${origin}|media:video`, true]])
      await expect.poll(() => chrome.evaluate(() => (window as FixtureWindow).microphoneTrack?.readyState)).toBe('ended')
      await application.evaluate(({ systemPreferences }) => { systemPreferences.getMediaAccessStatus = () => 'granted' })
    }
    await microphone.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect.poll(() => captureResult(page)).toEqual({ tracks: ['audio', 'video'] })
    expect(await grants()).toContainEqual([`${profile.id}|${origin}|media:audio`, true])
    expect(await permissionStates()).toEqual(['granted', 'granted'])

    await rpc('navigate', { pane: pane.id, url: otherPage })
    page = await browserPage(otherPage)
    await expect(page.getByRole('heading')).toHaveText('Video call fixture')
    await requestCapture(page, { video: true, audio: true })
    await expect.poll(() => captureResult(page)).toEqual({ tracks: ['audio', 'video'] })
    expect(await rpc('permission.list')).toEqual([])

    await openPermissions()
    let reset = permissions.getByRole('button', { name: 'Reset camera and mic permissions and reload', exact: true })
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), reset.click()])
    await permissions.getByRole('button', { name: 'Close', exact: true }).click()
    expect(await grants()).toEqual([])
    let frameUrl = `${origin}/microphone`
    await page.evaluate(url => {
      let iframe = document.createElement('iframe')
      iframe.src = url
      document.body.append(iframe)
    }, frameUrl)
    await expect(page.frameLocator('iframe').getByRole('heading')).toHaveText('Video call fixture')
    let frame = page.frame({ url: frameUrl })!
    await requestCapture(page, { video: true })
    await expect(camera).toBeVisible()
    await requestCapture(frame, { audio: true })
    let both = prompt('camera and microphone')
    await expect(both).toBeVisible()
    expect(await rpc('permission.list')).toMatchObject([{ paneId: pane.id, mediaDevices: ['video', 'audio'] }])
    await chrome.keyboard.press('Escape')
    await expect(both).toBeHidden()
    expect(await captureResult(page)).toBeUndefined()
    await chrome.getByRole('button', { name: 'Camera access: Review request', exact: true }).click()
    await both.getByRole('button', { name: 'Test devices', exact: true }).click()
    await expect(both.getByRole('combobox', { name: 'Camera', exact: true }).locator('option')).toHaveCount(3)
    await expect(both.getByRole('combobox', { name: 'Microphone', exact: true }).getByRole('option', { name: 'Fake Audio Input 2', exact: true })).toHaveCount(1)
    await expect.poll(() => both.getByLabel('Camera preview').evaluate(element => (element as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
    await expect.poll(() => both.getByRole('meter', { name: 'Microphone level' }).evaluate(element => (element as HTMLMeterElement).value)).toBeGreaterThan(0)
    await chrome.screenshot({ path: 'artifacts/media-permission-popup.png' })
    await both.getByRole('button', { name: 'Deny', exact: true }).click()
    await expect.poll(() => captureResult(page)).toEqual({ error: 'NotAllowedError' })
    await expect.poll(() => captureResult(frame)).toEqual({ error: 'NotAllowedError' })
    await requestCapture(page, { audio: true })
    await expect.poll(() => captureResult(page)).toEqual({ error: 'NotAllowedError' })
    expect(await rpc('permission.list')).toEqual([])
    await expect(microphone).toBeHidden()

    let microphoneBlocked = chrome.getByRole('button', { name: 'Microphone access: Blocked', exact: true })
    await microphoneBlocked.click()
    await expect(microphone).toContainText('Blocked for this site.')
    await microphone.getByRole('button', { name: 'Test microphone', exact: true }).click()
    await expect.poll(() => meter.evaluate(element => (element as HTMLMeterElement).value)).toBeGreaterThan(0)
    await microphone.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect(microphone).toBeHidden()
    await expect(chrome.getByRole('button', { name: 'Microphone access: Allowed', exact: true })).toBeVisible()
    await expect(chrome.getByRole('button', { name: 'Camera access: Blocked', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Turn on microphone', exact: true }).click()
    await expect.poll(() => captureResult(page)).toEqual({ tracks: ['audio'] })
    expect(await grants()).toEqual(expect.arrayContaining([[`${profile.id}|${origin}|media:audio`, true], [`${profile.id}|${origin}|media:video`, false]]))

    let clickPageButton = async (name: string) => {
      let bounds = await page.getByRole('button', { name, exact: true }).boundingBox()
      expect(bounds).toBeTruthy()
      let point = { x: Math.round(bounds!.x + bounds!.width / 2), y: Math.round(bounds!.y + bounds!.height / 2) }
      await expect.poll(() => application!.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url)?.isFocused(), otherPage)).toBe(true)
      await application!.evaluate(({ webContents }, { url, point }) => {
        let contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        contents.sendInputEvent({ ...point, type: 'mouseDown', button: 'left', clickCount: 1 })
        contents.sendInputEvent({ ...point, type: 'mouseUp', button: 'left', clickCount: 1 })
      }, { url: otherPage, point })
    }
    for (let name of ['Open issue', 'Start watching Camera Obscura']) {
      await clickPageButton(name)
      await expect(page.getByRole('status')).toHaveText(name)
      // Observe permission requests through the delay used for click-triggered prompts.
      await expect.poll(async () => {
        let elapsed = await page.locator('output').evaluate(output => performance.now() - Number(output.dataset.probedAt))
        if (elapsed < 250) return 'checking'
        let pending: unknown[] = await rpc('permission.list')
        return pending.length ? 'popup' : 'ready'
      }).toBe('ready')
      await expect(camera).toBeHidden()
    }
    await clickPageButton('Allow camera')
    await expect(camera).toBeVisible()
    expect(await page.evaluate(() => (window as FixtureWindow).preflight)).toBe('denied')
    expect(await captureResult(page)).toBeUndefined()
    await camera.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect(camera).toBeHidden()
    await clickPageButton('Allow camera')
    await expect.poll(() => captureResult(page)).toEqual({ tracks: ['video'] })
    expect(await page.evaluate(() => (window as FixtureWindow).preflightClicks)).toBe(2)
  } finally {
    await closeTestApplication(application)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
