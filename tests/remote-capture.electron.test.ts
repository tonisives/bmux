import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { remoteWebPreferences } from '../src/shared/remote-web-preferences'

let captureConfig = 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n'

test('background panes deliver static frames without a visible window', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-capture-'))
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Capture fixture</title><style>body{margin:0}</style><canvas width="640" height="480"></canvas><script>let n=0;let timer=setInterval(()=>{let c=document.querySelector("canvas").getContext("2d");c.fillStyle=++n%2?"red":"blue";c.fillRect(0,0,640,480)},100);window.stopFrames=()=>clearInterval(timer)</script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await fs.writeFile(path.join(directory, 'config.yaml'), captureConfig)
  let application = await electron.launch({ args: [path.join(process.cwd(), 'tests/fixtures/remote-main.mjs'), '--background'], env: { ...process.env, BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '1' } })
  try {
    let command = async (...args: string[]) => JSON.parse((await promisify(execFile)(process.execPath, ['bin/bmux.mjs', ...args], { env: { ...process.env, BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory } })).stdout).result
    let status = await command('status')
    expect(status.configError).toBeNull()
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
    // Frame callbacks can outpace the fixture's 100 ms color changes.
    await expect.poll(() => application.evaluate(() => (globalThis as typeof globalThis & { captureColors: Set<number> }).captureColors.size), { timeout: 15000 }).toBeGreaterThan(1)
    expect(await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().some(window => window.isVisible()))).toBe(false)
    await application.context().pages().find(page => page.url() === origin + '/')!.evaluate(() => (window as any).stopFrames())
    let source = application.context().pages().find(page => page.url() === origin + '/')!
    let initialVisibility = await source.evaluate(() => {
      ;(window as any).captureVisibility = []
      document.addEventListener('visibilitychange', () => (window as any).captureVisibility.push(document.visibilityState))
      return document.visibilityState
    })
    await application.evaluate(async ({ webContents, nativeImage }, { url, iceServers, relayOnly }) => {
      let contents = webContents.getAllWebContents().find(contents => contents.getURL() === url + '/')!
      contents.endFrameSubscription()
      let state = globalThis as any
      let capture = contents.capturePage.bind(contents)
      state.emptyRemoteFrames = 1
      state.remoteCaptureClosed = 0
      state.remoteCaptureCalls = 0
      contents.capturePage = (...args) => {
        state.remoteCaptureCalls++
        return state.emptyRemoteFrames-- > 0 ? Promise.resolve(nativeImage.createEmpty()) : capture(...args)
      }
      state.remoteCapture = await state.createTestCapture({ contents, iceServers, relayOnly, signal: (sdp: unknown) => { state.remoteOffer = sdp }, data: (data: string) => { state.remoteData = data }, closed: () => { state.remoteCaptureClosed++ } })
    }, { url: origin, iceServers, relayOnly })
    await expect.poll(() => application.evaluate(() => !!(globalThis as any).remoteOffer)).toBe(true)
    await test.step('Native focus lookup remains safe with an active hidden transport', async () => {
      await application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.id ?? null)
    })
    await application.evaluate(async ({ BrowserWindow }, { url, preferences }) => {
      let viewer = new BrowserWindow({ show: false, webPreferences: preferences })
      await viewer.loadURL(url + '/viewer')
    }, { url: origin, preferences: remoteWebPreferences })
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
    await expect.poll(() => viewer.evaluate(() => (window as any).testChannel?.readyState), { timeout: 15000 }).toBe('open')
    await expect.poll(() => viewer.evaluate(() => document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames ?? 0), { timeout: 15000 }).toBeGreaterThan(0)
    let color = await viewer.evaluate(() => { let video = document.querySelector('video')!; let canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; let context = canvas.getContext('2d')!; context.drawImage(video, 0, 0); return [...context.getImageData(100, 100, 1, 1).data] })
    expect(color[3]).toBe(255)
    expect(color[1]).toBeLessThan(100)
    expect(Math.max(color[0], color[2])).toBeGreaterThan(150)
    await application.evaluate(() => { (globalThis as any).emptyRemoteFrames = 3 })
    await application.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url + '/')!.endFrameSubscription(), origin)
    await application.context().pages().find(page => page.url() === origin + '/')!.evaluate(() => { let canvas = document.querySelector('canvas')!; let context = canvas.getContext('2d')!; context.fillStyle = 'green'; context.fillRect(0, 0, canvas.width, canvas.height) })
    await expect.poll(() => viewer.evaluate(() => { let video = document.querySelector('video')!; let canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; let context = canvas.getContext('2d')!; context.drawImage(video, 0, 0); return context.getImageData(100, 100, 1, 1).data[1] }), { timeout: 15000 }).toBeGreaterThan(100)
    await viewer.evaluate(() => (window as any).testChannel.send('capture-test'))
    await expect.poll(() => application.evaluate(() => (globalThis as any).remoteData), { timeout: 15000 }).toBe('capture-test')
    expect(await application.evaluate(() => (globalThis as any).remoteCaptureClosed)).toBe(0)
    expect(await source.evaluate(() => ({ visibility: document.visibilityState, changes: (window as any).captureVisibility }))).toEqual({ visibility: initialVisibility, changes: [] })
    if (relayOnly) expect(await viewer.evaluate(async () => {
      let stats = await (window as any).testPeer.getStats()
      let selected = [...stats.values()].find((item: any) => item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated) as any
      return stats.get(selected?.localCandidateId)?.candidateType
    })).toBe('relay')
    await test.step('A crashed source stops capture and rejects new watches without reloading', async () => {
      await viewer.evaluate(() => {
        ;(window as any).sourceCrashChannelClosed = false
        ;(window as any).testChannel.onclose = () => { (window as any).sourceCrashChannelClosed = true }
      })
      await application.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url + '/')!.forcefullyCrashRenderer(), origin)
      await expect.poll(() => application.evaluate(() => (globalThis as any).remoteCaptureClosed)).toBe(1)
      await expect.poll(() => viewer.evaluate(() => (window as any).sourceCrashChannelClosed), { timeout: 5000 }).toBe(true)
      console.info(`Source crash viewer: ${JSON.stringify(await viewer.evaluate(() => ({ peer: (window as any).testPeer.connectionState, channel: (window as any).testChannel.readyState })))}`)
      let calls = await application.evaluate(() => (globalThis as any).remoteCaptureCalls)
      let after = await application.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 500)); return (globalThis as any).remoteCaptureCalls })
      expect(after).toBe(calls)
      let rejected = await application.evaluate(async ({ BrowserWindow, webContents }, url) => {
        let state = globalThis as any, contents = webContents.getAllWebContents().find(contents => contents.getURL() === url + '/')!
        let windows = BrowserWindow.getAllWindows().length
        try {
          let capture = await state.createTestCapture({ contents, iceServers: [], signal: () => {}, data: () => {}, closed: () => {} })
          capture.close()
          return { error: null }
        } catch (error) { return { error: (error as Error).message, crashed: contents.isCrashed(), windowsUnchanged: BrowserWindow.getAllWindows().length === windows } }
      }, origin)
      expect(rejected).toEqual({ error: 'Page process crashed. Reload to recover.', crashed: true, windowsUnchanged: true })
      expect((await command('status')).crashes[pane.id]).toMatch(/Page process (?:crashed|killed)\. Reload to recover\./)
      expect(await application.evaluate(() => (globalThis as any).captureProcessFailures.filter((failure: { type: string }) => failure.type === 'GPU'))).toEqual([])
      await application.evaluate(() => (globalThis as any).remoteCapture.close())
      expect(await application.evaluate(() => (globalThis as any).remoteCaptureClosed)).toBe(1)
    })
    expect(await application.evaluate(() => (globalThis as any).captureFetchCalls)).toBe(0)
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a GPU failure stops captures while the headless host stays available', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-capture-gpu-'))
  let server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>GPU fixture</title><body style="background:red">GPU capture fixture</body>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await fs.writeFile(path.join(directory, 'config.yaml'), captureConfig)
  let application = await electron.launch({ args: [path.join(process.cwd(), 'tests/fixtures/remote-main.mjs'), '--background'], env: { ...process.env, BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '1' } })
  let child = application.process()
  try {
    let command = async (...args: string[]) => {
      let output = await promisify(execFile)(process.execPath, ['bin/bmux.mjs', ...args], { env: { ...process.env, BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory }, timeout: 20000 }).catch(error => { if (error.stdout) return { stdout: error.stdout }; throw error })
      let reply = JSON.parse(output.stdout)
      if (!reply.ok) throw new Error(reply.error)
      return reply.result
    }
    let status = await command('status')
    expect(status.configError).toBeNull()
    let pane = status.model.sessions[0].windows[0].panes[0].id
    await command('navigate', '-t', pane, origin)
    await command('wait', '-t', pane, '--selector', 'body')
    await application.evaluate(async ({ webContents }, origin) => {
      let state = globalThis as any, contents = webContents.getAllWebContents().find(contents => contents.getURL() === origin + '/')!
      let capture = contents.capturePage.bind(contents)
      state.gpuCaptureCalls = 0; state.gpuCaptureClosed = 0
      contents.capturePage = (...args) => { state.gpuCaptureCalls++; return capture(...args) }
      let send = contents.debugger.sendCommand.bind(contents.debugger)
      state.gpuCDPCaptureCalls = 0
      contents.debugger.sendCommand = (method, ...args) => { if (method === 'Page.captureScreenshot' || method === 'Page.startScreencast') state.gpuCDPCaptureCalls++; return send(method, ...args) }
      state.gpuCapture = await state.createTestCapture({ contents, iceServers: [], signal: () => {}, data: () => {}, closed: () => { state.gpuCaptureClosed++ } })
    }, origin)
    await expect.poll(() => application.evaluate(() => (globalThis as any).gpuCaptureCalls)).toBeGreaterThan(2)
    await application.evaluate(({ app }) => {
      let gpu = app.getAppMetrics().find(process => process.type === 'GPU')
      if (!gpu) throw new Error('No disposable GPU process exists')
      process.kill(gpu.pid, 'SIGKILL')
    })
    await expect.poll(() => application.evaluate(() => (globalThis as any).gpuCaptureClosed)).toBe(1)
    let calls = await application.evaluate(() => (globalThis as any).gpuCaptureCalls)
    let after = await application.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 500)); return (globalThis as any).gpuCaptureCalls })
    expect(after).toBe(calls)
    let error = await application.evaluate(async ({ webContents }, origin) => {
      let state = globalThis as any
      try { await state.createTestCapture({ contents: webContents.getAllWebContents().find(contents => contents.getURL() === origin + '/')!, iceServers: [], signal: () => {}, data: () => {}, closed: () => {} }) }
      catch (error) { return (error as Error).message }
      return null
    }, origin)
    expect(error).toBe('Video capture unavailable after GPU failure')
    for (let method of ['Page.captureScreenshot', 'Page.startScreencast']) await expect(command('cdp', '-t', pane, method)).rejects.toThrow('Video capture unavailable after GPU failure')
    await expect(command('screenshot', '-t', pane, '--output', path.join(directory, 'failed.png'))).rejects.toThrow('Video capture unavailable after GPU failure')
    expect(await application.evaluate(() => (globalThis as any).gpuCDPCaptureCalls)).toBe(0)
    expect((await command('status')).model.sessions).toHaveLength(1)
    expect((await command('rpc', 'diagnostics', '{}')).capture.error).toBe('Video capture unavailable after GPU failure')
    await application.evaluate(async () => {
      let state = globalThis as any
      state.managementOffer = undefined
      state.managementCapture = await state.createTestCapture({ iceServers: [], signal: (sdp: RTCSessionDescriptionInit) => { state.managementOffer = sdp }, data: () => {}, closed: () => {} })
    })
    await expect.poll(() => application.evaluate(() => !!(globalThis as any).managementOffer), { timeout: 15000 }).toBe(true)
    await application.evaluate(() => (globalThis as any).managementCapture.close())
    expect(await application.evaluate(() => (globalThis as any).captureFetchCalls)).toBe(0)
  } finally {
    await closeTestApplication(application, child)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

for (let rendering of ['default', 'software']) test(`seven hidden panes keep streaming through reconnects and odd viewport sizes (${rendering})`, async () => {
  test.setTimeout(180000)
  let phase = 'Launch the isolated headless capture host'
  let step = async <T,>(title: string, body: () => Promise<T>) => { phase = title; return test.step(title, body) }
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-capture-stress-'))
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Capture stress fixture</title><style>body{margin:0}canvas{position:fixed;inset:0;width:100%;height:100%}</style><canvas></canvas><script>let n=0;setInterval(()=>{let c=document.querySelector("canvas");c.width=innerWidth;c.height=innerHeight;let x=c.getContext("2d");x.fillStyle=++n%2?"red":"blue";x.fillRect(0,0,c.width,c.height);x.fillStyle="white";x.fillRect(n%Math.max(1,c.width-40),20,40,40)},100)</script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await fs.writeFile(path.join(directory, 'config.yaml'), captureConfig)
  let application = await step('Launch the isolated headless capture host', () => electron.launch({ timeout: 20000, args: [path.join(process.cwd(), 'tests/fixtures/remote-main.mjs'), '--background'], env: { ...process.env, BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '1', BMUX_LAZY_RESTORE_BACKGROUND: '1', BMUX_TEST_SOFTWARE_RENDERING: rendering === 'software' ? '1' : '0' } })).catch(async error => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    throw error
  })
  let child = application.process()
  let nativeErrors = ''
  child.stderr?.on('data', data => { for (let line of String(data).split('\n')) if (/CopyOutput|DESERIALIZATION|gpu_process_host|gpu_data_manager|shared_memory|FATAL/.test(line)) nativeErrors = (nativeErrors + line + '\n').slice(-65536) })
  let nativeDiagnostics: Promise<void> | undefined
  let collectNativeDiagnostics = (reason: string) => nativeDiagnostics ??= (async () => {
    let attach = async (name: string, body: string, contentType = 'text/plain') => {
      let output = test.info().outputPath(name)
      await fs.writeFile(output, body, { mode: 0o600 })
      await test.info().attach(name, { path: output, contentType })
    }
    if (nativeErrors) await attach('native-capture-errors.log', nativeErrors)
    let dialogs = await fs.readFile(path.join(directory, 'test-native-errors.log'), 'utf8').catch(() => undefined)
    if (dialogs) await attach('native-dialog-errors.log', dialogs)
    let heartbeat = await fs.readFile(path.join(directory, 'test-main-heartbeat.json'), 'utf8').then(text => JSON.parse(text) as { time: number }).catch(() => undefined)
    let processState = process.platform === 'linux' ? await fs.readFile(`/proc/${child.pid}/status`, 'utf8').then(text => text.split('\n').filter(line => /^(State|VmRSS|Threads|voluntary_ctxt_switches|nonvoluntary_ctxt_switches):/.test(line))).catch(() => undefined) : undefined
    let state = { reason, phase, pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode, processState, nativeErrors: !!nativeErrors, dialogs: !!dialogs, heartbeatAgeMs: heartbeat ? Date.now() - heartbeat.time : undefined }
    console.info(`Capture host process: ${JSON.stringify(state)}`)
    await attach('native-main-state.json', JSON.stringify(state), 'application/json')
    if (process.platform === 'linux' && process.env.BMUX_NATIVE_CRASH_DIAGNOSTICS === '1' && child.exitCode === null && child.signalCode === null) {
      let trace = await promisify(execFile)('gdb', ['--batch', '-p', String(child.pid), '-ex', 'set print frame-arguments none', '-ex', 'thread apply all bt', '-ex', 'detach'], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 }).then(result => result.stdout).catch(error => error.stdout || 'Native stack capture unavailable')
      await attach('native-main-stack.log', trace)
    }
  })().catch(error => { console.info(`Capture diagnostics: ${String(error)}`) })
  let watchdog = process.platform === 'linux' && process.env.BMUX_NATIVE_CRASH_DIAGNOSTICS === '1' ? setTimeout(() => { void collectNativeDiagnostics('150 second watchdog').catch(error => console.info(`Capture watchdog: ${String(error)}`)) }, 150000) : undefined
  try {
    if (rendering === 'software') expect(await application.evaluate(({ app }) => app.isHardwareAccelerationEnabled())).toBe(false)
    if (process.platform === 'linux' && process.env.BMUX_TEST_WINDOW_MANAGER === 'none') expect(await application.evaluate(({ app }) => ({ diskSharedMemory: app.commandLine.hasSwitch('disable-dev-shm-usage'), forcedFeatures: app.commandLine.hasSwitch('enable-features') }))).toEqual({ diskSharedMemory: process.env.BMUX_DISK_SHARED_MEMORY === '1', forcedFeatures: false })
    let command = async (...args: string[]) => {
      let output = await promisify(execFile)(process.execPath, ['bin/bmux.mjs', ...args], { env: { ...process.env, BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory }, timeout: 20000 }).catch(error => { if (error.stdout) return { stdout: error.stdout }; throw error })
      let reply = JSON.parse(output.stdout)
      if (!reply.ok) throw new Error(reply.error)
      return reply.result
    }
    let panes: string[] = [], urls: string[] = []
    let status = await command('status')
    expect(status.configError).toBeNull()
    await step('Load all seven hidden fixture panes', async () => {
      for (let index = 0; index < 7; index++) {
        let session = index ? await command('new-session', '-s', `capture-${index}`) : status.model.sessions[0]
        let pane = session.windows[0].panes[0].id, url = `${origin}/pane-${index}`
        panes.push(pane); urls.push(url)
        await command('navigate', '-t', pane, url)
        await command('wait', '-t', pane, '--selector', 'canvas')
      }
    })
    let frameCounts = async (viewer: import('@playwright/test').Page) => viewer.evaluate(() => [...document.querySelectorAll('video')].map(video => video.getVideoPlaybackQuality().totalVideoFrames))
    for (let round = 0; round < 2; round++) {
      await step(`Create seven capture transports for round ${round}`, () => application.evaluate(async ({ webContents }, urls) => {
        let state = globalThis as any
        state.stressOffers = []; state.stressData = []; state.stressClosed = 0
        state.stressCaptures = await Promise.all(urls.map(async (url, index) => {
          let contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)
          if (!contents) throw new Error(`Missing fixture pane ${index}`)
          return state.createTestCapture({ contents, iceServers: [], signal: (sdp: RTCSessionDescriptionInit) => { state.stressOffers[index] = sdp }, data: (data: string) => { state.stressData[index] = data }, closed: () => { state.stressClosed++ } })
        }))
      }, urls))
      await expect.poll(() => application.evaluate(() => (globalThis as any).stressOffers.filter(Boolean).length), { timeout: 20000 }).toBe(7)
      let viewerId = await step(`Create the hidden viewer for round ${round}`, () => application.evaluate(async ({ BrowserWindow }, { origin, preferences }) => {
        let viewer = new BrowserWindow({ show: false, webPreferences: preferences })
        await viewer.loadURL(origin + '/viewer')
        return viewer.id
      }, { origin, preferences: remoteWebPreferences }))
      await expect.poll(() => application.context().pages().some(page => page.url() === origin + '/viewer')).toBe(true)
      let viewer = application.context().pages().find(page => page.url() === origin + '/viewer')!
      let offers = await application.evaluate(() => (globalThis as any).stressOffers)
      let answers = await step(`Negotiate all seven peers for round ${round}`, () => viewer.evaluate(async offers => {
        let peers: RTCPeerConnection[] = [], channels: RTCDataChannel[] = []
        ;(window as any).stressPeers = peers; (window as any).stressChannels = channels; (window as any).stressChannelEvents = []
        return Promise.all(offers.map(async (offer: RTCSessionDescriptionInit, index: number) => {
          let peer = new RTCPeerConnection(), video = document.createElement('video')
          peers[index] = peer; video.muted = true; document.body.append(video)
          peer.ontrack = event => { video.srcObject = event.streams[0]; void video.play() }
          peer.ondatachannel = event => {
            let channel = event.channel
            channels[index] = channel
            let record = (event: string) => (window as any).stressChannelEvents.push({ index, event, state: channel.readyState })
            record('datachannel')
            channel.onopen = () => record('open')
            channel.onclose = () => record('close')
            channel.onerror = () => record('error')
          }
          await peer.setRemoteDescription(offer)
          await peer.setLocalDescription(await peer.createAnswer())
          if (peer.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
            let timer = setTimeout(() => reject(new Error('Fixture ICE gathering timed out')), 15000)
            peer.onicegatheringstatechange = () => { if (peer.iceGatheringState === 'complete') { clearTimeout(timer); resolve() } }
          })
          return peer.localDescription!.toJSON()
        }))
      }, offers))
      await application.evaluate((_electron, answers) => answers.forEach((answer: RTCSessionDescriptionInit, index: number) => (globalThis as any).stressCaptures[index].answer(answer)), answers)
      await expect.poll(async () => (await frameCounts(viewer)).filter(count => count > 2).length, { timeout: 30000 }).toBe(7)
      await expect.poll(() => viewer.evaluate(() => (window as any).stressChannels.filter((channel: RTCDataChannel) => channel.readyState === 'open').length), { timeout: 15000 }).toBe(7)
      for (let [width, height] of [[641, 479], [1279, 719], [1919, 1079]]) {
        let before = await frameCounts(viewer)
        await step(`Resize native panes to ${width} by ${height}`, () => application.evaluate(({ BaseWindow }, { urls, width, height }) => {
          let children = (view: Electron.View): Electron.View[] => [view, ...view.children.flatMap(children)]
          let views = urls.map(url => BaseWindow.getAllWindows().flatMap(window => children(window.contentView)).find(view => (view as Electron.WebContentsView).webContents?.getURL() === url))
          if (views.some(view => !view)) throw new Error('Missing fixture native view')
          setImmediate(() => { for (let view of views) view!.setBounds({ ...view!.getBounds(), width, height }) })
        }, { urls, width, height }))
        await expect.poll(() => application.evaluate(async ({ webContents }, urls) => Promise.all(urls.map(url => webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript('({width:innerWidth,height:innerHeight})'))), urls), { timeout: 15000 }).toEqual(urls.map(() => ({ width, height })))
        // A normal agent screenshot shares Chromium's copy-output path with the streams.
        await step(`Capture an agent screenshot at ${width} by ${height}`, () => command('screenshot', '-t', panes[round], '--viewport', '--output', path.join(directory, 'capture.png')))
        await expect.poll(async () => (await frameCounts(viewer)).filter((count, index) => count > before[index] + 2).length, { timeout: 30000 }).toBe(7)
        expect(await application.evaluate(() => (globalThis as any).captureProcessFailures)).toEqual([])
      }
      await viewer.evaluate(round => (window as any).stressChannels.forEach((channel: RTCDataChannel, index: number) => channel.send(`round-${round}-${index}`)), round)
      await expect.poll(() => application.evaluate(() => (globalThis as any).stressData), { timeout: 15000 }).toEqual(panes.map((_pane, index) => `round-${round}-${index}`))
      expect(await application.evaluate(() => (globalThis as any).stressClosed)).toBe(0)
      await step(`Close all transports and the viewer for round ${round}`, async () => {
        await application.evaluate(() => (globalThis as any).stressCaptures.forEach((capture: { close: () => void }) => capture.close()))
        await application.evaluate(({ BrowserWindow }, id) => { setImmediate(() => BrowserWindow.fromId(id)?.destroy()) }, viewerId)
        await expect.poll(() => application.evaluate(({ BrowserWindow }, id) => !!BrowserWindow.fromId(id), viewerId)).toBe(false)
      })
    }
    expect(await application.evaluate(() => (globalThis as any).captureProcessFailures)).toEqual([])
    expect(await application.evaluate(() => (globalThis as any).captureFetchCalls)).toBe(0)
    expect(await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().some(window => window.isVisible()))).toBe(false)
    let result = await application.evaluate(({ app }) => ({ hardwareAcceleration: app.isHardwareAccelerationEnabled(), features: app.getGPUFeatureStatus(), switches: Object.fromEntries(['disable-gpu', 'disable-gpu-compositing', 'disable-dev-shm-usage', 'in-process-gpu', 'use-angle', 'use-gl', 'ozone-platform', 'enable-features'].filter(name => app.commandLine.hasSwitch(name)).map(name => [name, app.commandLine.getSwitchValue(name)])), versions: { electron: process.versions.electron, chrome: process.versions.chrome }, windowManager: process.env.BMUX_TEST_WINDOW_MANAGER ?? 'native', resources: (globalThis as any).captureResources(), failures: (globalThis as any).captureProcessFailures }))
    console.info(`Capture stress (${rendering}): ${JSON.stringify(result)}`)
    await test.info().attach('capture-rendering.json', { body: JSON.stringify(result), contentType: 'application/json' })
  } catch (error) {
    await collectNativeDiagnostics('test failure')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      let diagnostics = await Promise.race([application.evaluate(async ({ webContents }) => ({
        resources: (globalThis as any).captureResources(),
        failures: (globalThis as any).captureProcessFailures,
        contents: await Promise.all(webContents.getAllWebContents().map(async contents => ({
          id: contents.id, crashed: contents.isCrashed(), loading: contents.isLoading(),
          transport: contents.getURL().endsWith('/viewer') ? await contents.executeJavaScript(`(async () => ({
            peers: await Promise.all((window.stressPeers ?? []).map(async peer => ({
              connection: peer.connectionState, ice: peer.iceConnectionState,
              signaling: peer.signalingState, sctp: peer.sctp?.state,
              channels: [...(await peer.getStats()).values()].filter(stat => stat.type === 'data-channel').map(stat => ({
                state: stat.state, messagesSent: stat.messagesSent, messagesReceived: stat.messagesReceived,
              })),
            }))),
            channels: Array.from({ length: 7 }, (_, index) => window.stressChannels?.[index]?.readyState ?? 'missing'),
            events: window.stressChannelEvents,
          }))()`).catch(() => null) : undefined,
        }))),
      })), new Promise(resolve => { timer = setTimeout(() => resolve({ error: 'Capture failure diagnostics timed out' }), 5000) })]).catch(() => null)
      console.info(`Capture stress failure (${rendering}): ${JSON.stringify(diagnostics)}`)
    } finally { clearTimeout(timer) }
    throw error
  } finally {
    clearTimeout(watchdog)
    await nativeDiagnostics
    await step('Close the isolated capture host', () => closeTestApplication(application, child))
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
