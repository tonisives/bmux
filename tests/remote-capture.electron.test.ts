import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('background panes deliver changing frames without a visible window', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-capture-'))
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Capture fixture</title><style>body{margin:0}</style><canvas width="640" height="480"></canvas><script>let n=0;setInterval(()=>{let c=document.querySelector("canvas").getContext("2d");c.fillStyle=++n%2?"red":"blue";c.fillRect(0,0,640,480)},100)</script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  autoUpdateFilters: false\n')
  let application = await electron.launch({ args: [path.join(process.cwd(), 'tests/fixtures/remote-main.mjs'), '--background'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '1' } })
  try {
    let command = async (...args: string[]) => JSON.parse((await promisify(execFile)(process.execPath, ['bin/bmux.mjs', ...args], { env: { ...process.env, BMUX_DATA_DIR: directory } })).stdout).result
    let status = await command('status')
    let pane = status.model.sessions[0].windows[0].panes[0]
    await command('navigate', '-t', pane.id, origin)
    await command('wait', '-t', pane.id, '--selector', 'canvas')
    let iceServers = JSON.parse(process.env.BMUX_TEST_ICE_SERVERS ?? '[]') as RTCIceServer[]
    let relayOnly = process.env.BMUX_TEST_RELAY_ONLY === '1'
    await application.evaluate(async ({ webContents }, url) => {
      let contents = webContents.getAllWebContents().find(contents => contents.getURL() === url + '/')
      if (!contents) throw new Error('No background pane exists')
      contents.setBackgroundThrottling(false)
      let state = globalThis as typeof globalThis & { captureFrames: number; captureColors: Set<number> }
      state.captureFrames = 0
      state.captureColors = new Set()
      contents.beginFrameSubscription(true, frame => {
        state.captureFrames++
        let pixels = frame.toBitmap()
        if (pixels.length >= 4) state.captureColors.add(pixels.readUInt32LE(0))
      })
      await contents.loadURL(url)
    }, origin)
    await expect.poll(() => application.evaluate(() => (globalThis as typeof globalThis & { captureFrames: number }).captureFrames), { timeout: 15000 }).toBeGreaterThan(5)
    expect(await application.evaluate(() => (globalThis as typeof globalThis & { captureColors: Set<number> }).captureColors.size)).toBeGreaterThan(1)
    expect(await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().some(window => window.isVisible()))).toBe(false)
    await application.evaluate(async ({ webContents }, { url, iceServers, relayOnly }) => {
      let contents = webContents.getAllWebContents().find(contents => contents.getURL() === url + '/')!
      contents.endFrameSubscription()
      let state = globalThis as any
      state.remoteCapture = await state.createTestCapture({ contents, iceServers, relayOnly, signal: (sdp: unknown) => { state.remoteOffer = sdp }, data: (data: string) => { state.remoteData = data }, closed: () => undefined })
    }, { url: origin, iceServers, relayOnly })
    await expect.poll(() => application.evaluate(() => !!(globalThis as any).remoteOffer)).toBe(true)
    await application.evaluate(async ({ BrowserWindow }, url) => {
      let viewer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
      await viewer.loadURL(url + '/viewer')
    }, origin)
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/viewer'))).toBe(true)
    let viewer = application.context().pages().find(page => page.url().endsWith('/viewer'))!
    let offer = await application.evaluate(() => (globalThis as any).remoteOffer)
    let answer = await viewer.evaluate(async ({ offer, iceServers, relayOnly }) => {
      let peer = new RTCPeerConnection({ iceServers, iceTransportPolicy: relayOnly ? 'relay' : 'all' })
      let video = document.createElement('video'); video.muted = true; document.body.append(video)
      peer.ontrack = event => { video.srcObject = event.streams[0]; void video.play() }
      peer.ondatachannel = event => { (window as any).testChannel = event.channel }
      await peer.setRemoteDescription(offer)
      await peer.setLocalDescription(await peer.createAnswer())
      if (peer.iceGatheringState !== 'complete') await new Promise<void>(resolve => { peer.onicegatheringstatechange = () => { if (peer.iceGatheringState === 'complete') resolve() } })
      ;(window as any).testPeer = peer
      return peer.localDescription!.toJSON()
    }, { offer, iceServers, relayOnly })
    await application.evaluate((_electron, answer) => (globalThis as any).remoteCapture.answer(answer), answer)
    await expect.poll(() => viewer.evaluate(() => document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames ?? 0), { timeout: 15000 }).toBeGreaterThan(5)
    await expect.poll(() => viewer.evaluate(() => (window as any).testChannel?.readyState), { timeout: 15000 }).toBe('open')
    await viewer.evaluate(() => (window as any).testChannel.send('capture-test'))
    await expect.poll(() => application.evaluate(() => (globalThis as any).remoteData), { timeout: 15000 }).toBe('capture-test')
    if (relayOnly) expect(await viewer.evaluate(async () => {
      let stats = await (window as any).testPeer.getStats()
      let selected = [...stats.values()].find((item: any) => item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated) as any
      return stats.get(selected?.localCandidateId)?.candidateType
    })).toBe('relay')
    await application.evaluate(() => (globalThis as any).remoteCapture.close())
  } finally {
    await application.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
