import { prepareDemoDisplay } from './demo-display'
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let exec = promisify(execFile)
let loginDirectory = path.join(os.homedir(), 'bmux-demo-cloud')
let options = JSON.parse(await fs.readFile(new URL('./demo-options.json', import.meta.url), 'utf8').catch(() => '{}'))
let pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
type Cue = { at: number; kind: 'title' | 'detail' | 'keys' | 'mouse' | 'layout' | 'command'; text: string; x?: number; y?: number; action?: 'move' | 'click' | 'down' | 'up' | 'hide'; fromX?: number; fromY?: number; duration?: number }

test('record agentic browsing in bmux', async () => {
  if (process.env.BMUX_TEST_NATIVE !== '1' && process.env.GITHUB_ACTIONS !== 'true') throw new Error('Use the Tart runner.')
  await prepareDemoDisplay()
  let root = process.cwd(), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-agentic-demo-'))
  if (!options.publicPreview) {
    await fs.access(path.join(loginDirectory, 'demo-ready'))
    await fs.cp(loginDirectory, directory, { recursive: true, filter: source => !['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'Cache', 'Code Cache', 'GPUCache', 'Crashpad'].includes(path.basename(source)) })
  }
  let destination = path.join(root, 'artifacts', 'demo-video'), captureDirectory = path.join(destination, 'frames')
  let application: ElectronApplication | undefined, server: http.Server | undefined, loop: Promise<void> | undefined
  let workers: Promise<void>[] = [], stopAgents = false
  let frames: { file: string; at: number }[] = [], cues: Cue[] = [], stopped = false, started = 0, recordingStart = 0
  let part = options.part ?? (options.shellOnly ? 'shell' : 'all')
  if (!['all', 'workspace', 'shell', 'parallel', 'profiles'].includes(part)) throw new Error(`Unknown capture part: ${part}`)
  let cue = (kind: Cue['kind'], text: string, x?: number, y?: number, action?: Cue['action']) => cues.push({ at: Number(((Date.now() - started) / 1000).toFixed(2)), kind, text, x, y, action })
  let cli = async (method: string, args: Record<string, unknown> = {}) => {
    let result = await exec(process.execPath, [path.join(root, 'bin/bmux.mjs'), 'rpc', method, JSON.stringify(args)], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 30000, maxBuffer: 16 * 1024 * 1024 })
    let response = JSON.parse(result.stdout)
    if (!response.ok) throw new Error(response.error)
    return response.result
  }
  let app = () => application!
  let pageFor = (fragment: string) => app().context().pages().find(page => page.url().includes(fragment))!
  let origin = async (page: Page) => app().evaluate(({ BaseWindow }, url) => {
    let window = BaseWindow.getAllWindows().find(item => item.isVisible())!
    let view = window.contentView.children.find(item => item.webContents?.getURL() === url)
    if (!view) throw new Error('Visible native view not found')
    let bounds = window.getBounds(), frame = view.getBounds()
    return { x: bounds.x + frame.x, y: bounds.y + frame.y }
  }, page.url())
  let pointer: { x: number; y: number } | undefined
  let hidePointer = () => { cue('mouse', '', undefined, undefined, 'hide'); pointer = undefined }
  let move = async (page: Page, x: number, y: number) => {
    let point = await origin(page), target = { x: point.x + x, y: point.y + y }
    let from = pointer ?? target
    cue('mouse', '', target.x, target.y, 'move')
    Object.assign(cues.at(-1)!, { fromX: from.x, fromY: from.y, duration: .3 })
    for (let step = 1; step <= 12; step++) {
      let live = await origin(page), fraction = step / 12
      await page.mouse.move(from.x + (target.x - from.x) * fraction - live.x, from.y + (target.y - from.y) * fraction - live.y)
      await pause(20)
    }
    pointer = target
    await pause(120)
  }
  let chapter = async (title: string) => { console.log(`Demo chapter: ${title}`); hidePointer(); cue('title', title); await pause(1500) }
  let click = async (page: Page, locator: Locator) => {
    await locator.scrollIntoViewIfNeeded()
    let box = await locator.boundingBox()
    if (!box) throw new Error('Click target has no bounds')
    let x = box.x + box.width / 2, y = box.y + box.height / 2, point = await origin(page)
    await move(page, x, y)
    cue('mouse', '', point.x + x, point.y + y, 'click')
    await page.mouse.down()
    await pause(100)
    await page.mouse.up()
  }
  let keys = async (label: string, ...events: { keyCode: string; modifiers?: string[] }[]) => {
    hidePointer()
    cue('keys', label)
    await pause(400)
    await app().evaluate(async ({ webContents }, values) => {
      let target = webContents.getFocusedWebContents()
      if (!target) throw new Error('No focused web contents')
      for (let event of values) {
        target.sendInputEvent({ type: 'keyDown', ...event })
        target.sendInputEvent({ type: 'keyUp', ...event })
        await new Promise(resolve => setTimeout(resolve, 180))
      }
    }, events)
    await pause(700)
  }
  let shortcut = (label: string, keyCode: string, modifiers?: string[]) => keys(label, { keyCode: 'b', modifiers: ['control'] }, { keyCode, modifiers })
  let pageKey = async (page: Page, label: string, key: string) => {
    hidePointer()
    cue('keys', label)
    await pause(400)
    await page.keyboard.press(key)
    await pause(700)
  }
  let quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
  let denyPendingPermissions = async () => {
    for (let request of await cli('permission.list')) await cli('permission.respond', { id: request.id, allow: false })
  }
  let sessionPicker = async () => {
    await expect.poll(async () => {
      let counts = await Promise.all(app().context().pages().map(page => page.locator('[role="dialog"][aria-label="Sessions"]').count()))
      return counts.reduce((sum, count) => sum + count, 0)
    }).toBeGreaterThan(0)
    for (let page of app().context().pages()) if (await page.locator('[role="dialog"][aria-label="Sessions"]').count()) return { page, picker: page.locator('[role="dialog"][aria-label="Sessions"]') }
    throw new Error('Session picker disappeared')
  }
  let currentChrome = async () => {
    for (let page of app().context().pages()) {
      if (!page.url().endsWith('/renderer/index.html') || !await page.locator('button[aria-label="Sessions"]').count()) continue
      try { await origin(page); return page } catch { /* Ignore parked renderer views. */ }
    }
    throw new Error('Active bmux renderer was not found')
  }
  let dismissWebsiteSurvey = async (page: Page) => {
    for (let frame of page.frames()) {
      if (!await frame.getByText('Overall, how satisfied are you with this website?', { exact: false }).count()) continue
      let close = frame.locator('button[aria-label*="close" i], [role="button"][aria-label*="close" i]').first()
      if (await close.count()) await close.click({ timeout: 3000 })
    }
  }

  try {
    await fs.mkdir(destination, { recursive: true })
    // Only the disposable guest's Terminal is reset before recording.
    await exec('/usr/bin/killall', ['Terminal']).catch(() => undefined)
    await exec('/usr/bin/defaults', ['write', '-g', 'AppleShowScrollBars', '-string', 'WhenScrolling'])
    await exec('/usr/bin/defaults', ['write', 'com.apple.Terminal', 'AppleShowScrollBars', '-string', 'WhenScrolling'])
    server = http.createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ip: '127.0.0.1', city: 'Local demo' }))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    await fs.writeFile(path.join(directory, 'config.yaml'), 'accessibility: true\nkeyboard:\n  shortcuts:\n    j: { action: scroll-down, when: pane-not-editing }\n    k: { action: scroll-up, when: pane-not-editing }\n')
    application = await electron.launch({ args: [root], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_PROXY_TEST_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}/ip` } })
    await expect.poll(() => app().context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = pageFor('/renderer/index.html'), state = await cli('state'), client = state.model.clients[0]
    let research = options.publicPreview ? state.model.sessions[0] : state.model.sessions.find((session: { name: string }) => session.name === 'cloud research'), compute = research.windows[0].panes[0]
    await cli('rename-session', { session: research.id, name: 'cloud research' })
    let computeUrl = options.publicPreview ? 'https://cloud.google.com/products/compute' : compute.url
    if (!options.publicPreview && (!computeUrl.startsWith('https://console.cloud.google.com/compute') || !new URL(computeUrl).searchParams.get('project'))) throw new Error('Finish Google Cloud login and choose a project on Compute Engine before recording.')
    await cli('navigate', { pane: compute.id, url: computeUrl })
    await cli('wait', { pane: compute.id, selector: 'body', timeout: 30000 })
    if (!options.publicPreview) {
      await pause(5000)
      expect(await cli('eval', { pane: compute.id, expression: 'location.hostname' })).toBe('console.cloud.google.com')
    }
    let destinations = [
      { name: 'DEV agent', url: 'https://dev.to/t/cloud', selector: 'body' },
      { name: 'Reddit agent', url: 'https://www.reddit.com/r/technology/', selector: 'body' },
      { name: 'HN agent', url: 'https://news.ycombinator.com/', selector: 'body' },
      { name: 'GitHub agent', url: 'https://github.com/topics/browser-automation', selector: 'body' },
    ]
    let profiles = []
    for (let item of destinations) profiles.push(await cli('profile.create', { name: item.name, background: true }))
    let agents = await cli('new-session', { name: 'agent desk', profile: profiles[0].id }), first = agents.windows[0].panes[0]
    await cli('navigate', { pane: first.id, url: destinations[0].url })
    await cli('wait', { pane: first.id, selector: destinations[0].selector, timeout: 30000 })
    let right = await cli('split-window', { pane: first.id, profile: profiles[1].id, url: destinations[1].url })
    await cli('wait', { pane: right.id, selector: destinations[1].selector, timeout: 30000 })
    for (let attempt = 0; attempt < 20; attempt++) { await denyPendingPermissions(); await pause(200) }
    let lowerLeft = await cli('split-window', { pane: first.id, axis: 'vertical', profile: profiles[2].id, url: destinations[2].url })
    await cli('wait', { pane: lowerLeft.id, selector: destinations[2].selector, timeout: 30000 })
    let lowerRight = await cli('split-window', { pane: right.id, axis: 'vertical', profile: profiles[3].id, url: destinations[3].url })
    await cli('wait', { pane: lowerRight.id, selector: destinations[3].selector, timeout: 30000 })
    await denyPendingPermissions()
    expect(new Set((await cli('state')).model.sessions.find((item: { id: string }) => item.id === agents.id).windows[0].panes.map((pane: { profileId: string }) => pane.profileId)).size).toBe(4)

    await cli('switch-client', { client: client.id, session: research.id })
    await cli('select-pane', { client: client.id, pane: compute.id })
    let initialBounds: { x: number; y: number; width: number; height: number } = await app().evaluate(({ BaseWindow, screen }) => {
      if (screen.getPrimaryDisplay().bounds.width < 1400) throw new Error(`Demo display is too narrow: ${screen.getPrimaryDisplay().bounds.width}`)
      let window = BaseWindow.getAllWindows().find(item => item.isVisible())!
      window.setBounds({ x: 20, y: 105, width: 1344, height: 680 })
      return window.getBounds()
    })
    await cli('focus-page', { client: client.id })
    await pause(1800)
    await fs.mkdir(captureDirectory)
    recordingStart = Date.now()
    let captureFrames = async () => {
      while (!stopped) {
        let file = path.join(captureDirectory, `${String(frames.length).padStart(5, '0')}.jpg`)
        let before = Date.now()
        await exec('/usr/sbin/screencapture', ['-x', '-m', '-tjpg', file], { timeout: 10000 })
        frames.push({ file, at: ((before + Date.now()) / 2 - recordingStart) / 1000 })
        await pause(5)
      }
    }
    loop = captureFrames()
    await pause(1800)
    started = Date.now()
    if (part === 'all' || part === 'workspace') {
    await chapter('Browse with panes and sessions')
    let computePage = pageFor(options.publicPreview ? 'cloud.google.com/products/compute' : 'console.cloud.google.com/compute')
    await pause(1200)
    if (!options.publicPreview) {
      let instance = computePage.locator('a[href*="/compute/instancesDetail/"]').first()
      if (await instance.count()) {
        await click(computePage, instance)
        await pause(1800)
      }
    }

    await chapter('Split panes')
    await shortcut('Ctrl + B   %', '%', ['shift'])
    await expect.poll(async () => (await cli('state')).model.sessions.find((item: { id: string }) => item.id === research.id).windows[0].panes.length).toBe(2)
    let docs = (await cli('state')).model.sessions.find((item: { id: string }) => item.id === research.id).windows[0].panes.find((pane: { id: string }) => pane.id !== compute.id)
    await pause(900)
    cue('title', 'Open docs beside your console')
    await keys('Cmd + L', { keyCode: 'l', modifiers: ['meta'] })
    let addressChrome = await currentChrome()
    await addressChrome.getByRole('textbox', { name: 'URL or search' }).pressSequentially('https://docs.cloud.google.com/compute/docs', { delay: 30 })
    await pause(1200)
    await pageKey(addressChrome, 'Enter', 'Enter')
    await cli('wait', { pane: docs.id, selector: 'a[href*="/compute/docs/instances"]', timeout: 30000 })
    let docsPage = pageFor('docs.cloud.google.com/compute/docs')
    await pause(1500)
    await chapter('Navigate with the keyboard')
    await cli('focus-page', { client: client.id })
    for (let key of ['j', 'j', 'j', 'k', 'k', 'k']) {
      hidePointer()
      cue('keys', key)
      Object.assign(cues.at(-1)!, { duration: .7 })
      let before = await docsPage.evaluate(() => scrollY)
      await app().evaluate(({ webContents }, keyCode) => {
        let target = webContents.getFocusedWebContents()!
        target.sendInputEvent({ type: 'keyDown', keyCode })
        target.sendInputEvent({ type: 'keyUp', keyCode })
      }, key)
      await expect.poll(() => docsPage.evaluate(() => scrollY)).not.toBe(before)
      await pause(650)
    }

    await chapter('Click Mode: choose a link')
    await cli('select-pane', { client: client.id, pane: docs.id })
    await cli('focus-page', { client: client.id })
    await keys('Option   Option', { keyCode: 'Alt', modifiers: ['alt'] }, { keyCode: 'Alt', modifiers: ['alt'] })
    await expect(docsPage.locator('[data-bmux-click-mode]')).toHaveCount(1)
    let actions = (await currentChrome()).getByRole('group', { name: 'Click mode actions' })
    expect(await actions.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await pause(1500)
    let tree = await cli('cdp', { pane: docs.id, method: 'Page.getFrameTree' })
    let world = await cli('cdp', { pane: docs.id, method: 'Page.createIsolatedWorld', params: { frameId: tree.frameTree.frame.id, worldName: 'bmux:click-mode' } })
    let result = await cli('cdp', { pane: docs.id, method: 'Runtime.evaluate', params: { contextId: world.executionContextId, returnByValue: true, expression: `(() => {
      let mode = globalThis.__bmuxClickMode
      if (!mode) return { hint: null, diagnostic: 'Click Mode world is missing' }
      let labels = Array.from(mode.shadow.querySelectorAll('span')).filter(item => item.style.position === 'fixed')
      for (let element of mode.elements) {
        let rect = element.getBoundingClientRect()
        if (!element.textContent?.includes('Read product documentation') || !element.href || rect.width < 1 || rect.bottom < 0 || rect.top > innerHeight) continue
        let label = labels.find(item => Math.abs(parseFloat(item.style.left) - Math.max(0, rect.left) - 2) < 3 && Math.abs(parseFloat(item.style.top) - Math.max(0, rect.top) - 2) < 3)
        if (label) return { hint: label.textContent, diagnostic: '' }
      }
      return { hint: null, diagnostic: JSON.stringify({ links: mode.elements.filter(element => element.href?.includes('compute')).slice(0, 6).map(element => ({ href: element.href, rect: element.getBoundingClientRect().toJSON() })), labels: labels.slice(0, 8).map(item => ({ text: item.textContent, left: item.style.left, top: item.style.top })) }) }
    })()` } })
    let hint = result.result.value?.hint
    if (!hint) throw new Error(`No visible docs link for Click Mode: ${result.result.value?.diagnostic ?? result.exceptionDetails?.text}`)
    cue('title', 'Choose a link with its hint')
    await keys(hint.split('').join('   '), ...hint.split('').map(keyCode => ({ keyCode: keyCode.toLowerCase() })))
    await pause(1800)
    await keys('Cmd + [', { keyCode: '[', modifiers: ['meta'] })
    await pause(1500)

    await chapter('Keep a reference in a floating pane')
    await cli('focus-page', { client: client.id })
    await keys('Option   Option', { keyCode: 'Alt', modifiers: ['alt'] }, { keyCode: 'Alt', modifiers: ['alt'] })
    await expect(docsPage.locator('[data-bmux-click-mode]')).toHaveCount(1)
    await pause(900)
    await keys('F', { keyCode: 'f' })
    await pause(700)
    await keys(hint.split('').join('   '), ...hint.split('').map(keyCode => ({ keyCode: keyCode.toLowerCase() })))
    await expect.poll(async () => (await cli('state')).model.sessions.find((item: { id: string }) => item.id === research.id).windows[0].floating?.length ?? 0).toBe(1)
    await pause(1300)
    await cli('select-pane', { client: client.id, pane: docs.id })
    await cli('focus-page', { client: client.id })
    await shortcut('Ctrl + B   X', 'x')
    await pause(1800)
    let floatPage = pageFor('#float=')
    let drag = async (target: Locator, dx: number, dy: number) => {
      let box = await target.boundingBox()
      if (!box) throw new Error('Floating drag target is missing')
      let x = box.x + box.width / 2, y = box.y + box.height / 2
      await move(floatPage, x, y)
      let start = { ...pointer! }
      cue('mouse', '', start.x, start.y, 'down')
      await floatPage.mouse.down()
      for (let step = 1; step <= 16; step++) {
        let target = { x: start.x + dx * step / 16, y: start.y + dy * step / 16 }
        let live = await origin(floatPage)
        cue('mouse', '', target.x, target.y, 'move')
        await floatPage.mouse.move(target.x - live.x, target.y - live.y)
        pointer = target
        await pause(18)
      }
      await floatPage.mouse.up()
      cue('mouse', '', pointer!.x, pointer!.y, 'up')
      await pause(350)
    }
    cue('title', 'Resize and move the reference')
    let frame = await floatPage.locator('[data-floating-pane]').boundingBox()
    if (!frame) throw new Error('Floating frame is missing')
    await drag(floatPage.getByRole('separator', { name: 'Resize floating pane se', exact: true }), 550 - frame.width, 535 - frame.height)
    let current = await origin(floatPage)
    await drag(floatPage.getByRole('button', { name: 'Move floating pane' }), initialBounds.x + 770 - current.x, initialBounds.y + 60 - current.y)
    await pause(700)
    let floatingId = floatPage.url().split('#float=')[1]
    let floatingPane = (await cli('state')).model.sessions.find((item: { id: string }) => item.id === research.id).windows[0].panes.find((pane: { id: string }) => pane.id === floatingId)
    let referencePage = pageFor(floatingPane.url)
    await move(referencePage, 150, 150)
    await referencePage.mouse.wheel(0, 320)
    await pause(1800)
    // Preserve the reference when this session is restored.
    await cli('navigate', { pane: floatingId, url: 'https://docs.cloud.google.com/compute/docs/instances/create-start-instance' })
    await cli('wait', { pane: floatingId, selector: 'h1', timeout: 30000 })
    await chapter('Read how to create an instance')
    referencePage = pageFor('docs.cloud.google.com/compute/docs/instances/create-start-instance')
    await move(referencePage, 180, 250)
    await referencePage.mouse.wheel(0, 420)
    await pause(1600)

    await chapter('Sessions keep separate workspaces')
    await cli('select-pane', { client: client.id, pane: compute.id })
    await cli('focus-page', { client: client.id })
    await shortcut('Ctrl + B   S', 's')
    let sessionSelection = await sessionPicker()
    await pause(700)
    hidePointer()
    cue('keys', 'agent')
    await sessionSelection.picker.getByRole('textbox', { name: 'Search sessions' }).pressSequentially('agent', { delay: 140 })
    await pause(500)
    await pageKey(sessionSelection.page, 'Enter', 'Enter')
    await pause(900)

    await chapter('Switch back without losing your place')
    await denyPendingPermissions()
    await cli('client.overlay', { client: client.id, visible: true })
    chrome = await currentChrome()
    await click(chrome, chrome.locator('button[aria-label="Sessions"]'))
    let { page: sessionChrome, picker } = await sessionPicker()
    await pause(600)
    hidePointer()
    cue('keys', 'cloud')
    await picker.getByRole('textbox', { name: 'Search sessions' }).pressSequentially('cloud', { delay: 140 })
    await pause(500)
    await pageKey(sessionChrome, 'Enter', 'Enter')
    await cli('client.overlay', { client: client.id, visible: false })
    await expect.poll(async () => (await cli('state')).model.sessions.find((item: { id: string }) => item.id === research.id).windows[0].floating?.length ?? 0).toBe(1)
    await dismissWebsiteSurvey(computePage)
    await pause(1800)
    await cli('focus-page', { client: client.id })
    await shortcut('Ctrl + B   S', 's')
    ;({ page: sessionChrome, picker } = await sessionPicker())
    hidePointer()
    cue('keys', 'agent')
    await picker.getByRole('textbox', { name: 'Search sessions' }).pressSequentially('agent', { delay: 140 })
    await pause(500)
    await pageKey(sessionChrome, 'Enter', 'Enter')
    await pause(1200)

    }
    if (part === 'all' || part === 'shell') {
    await cli('eval', { pane: lowerLeft.id, expression: 'window.scrollTo(0, 0)' })
    await cli('switch-client', { client: client.id, session: agents.id })
    await chapter('Agent control and monitoring')
    await cli('select-pane', { client: client.id, pane: lowerLeft.id })
    await cli('focus-page', { client: client.id })
    // Resize first, then zoom while capture is paused: no full-width flash.
    stopped = true
    await loop
    await app().evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find(item => item.isVisible())!.setBounds({ x: 468, y: 105, width: 896, height: 680 }))
    await cli('toggle-pane-zoom', { client: client.id })
    await cli('zoom', { pane: lowerLeft.id, factor: 1 })
    let executable = `${quote(process.execPath)} ${quote(path.join(root, 'bin/bmux.mjs'))}`
    let done = path.join(directory, 'shell-done')
    let scrolled = path.join(directory, 'shell-scrolled')
    let extracted = path.join(directory, 'shell-extracted')
    let script = path.join(directory, 'agent-control.command')
    let target = lowerLeft.id
    let lines = [
      '#!/bin/zsh',
      'set -eu',
      `export BMUX_DATA_DIR=${quote(directory)}`,
      "printf '\\033[3;20;105t\\033[8;40;53t'",
      'clear',
      'sleep 3',
      'type_line() { local line="$1"; for ((index=1; index<=${#line}; index++)); do printf "%s" "${line[index]}"; sleep 0.016; done; printf "\\n"; }',
      `type_line ${quote(`$ bmux key -t ${target} PageDown`)}`,
      `${executable} key -t ${quote(target)} PageDown > /dev/null`,
      `touch ${quote(scrolled)}`,
      'sleep 2',
      `type_line ${quote(`$ bmux dom -t ${target} |`)}`,
      `type_line ${quote(`  jq -r '.result.content' |`)}`,
      `type_line ${quote("  grep 'Show HN:' |")}`,
      `type_line ${quote('  head -n 3')}`,
      `${executable} dom -t ${quote(target)} | jq -r '.result.content' | grep 'Show HN:' | head -n 3 | tee ${quote(extracted)}`,
      'sleep 4',
      `type_line ${quote(`$ bmux click -t ${target} --selector '.athing .titleline > a'`)}`,
      `${executable} click -t ${quote(target)} --selector '.athing .titleline > a' > /dev/null`,
      `touch ${quote(done)}`,
      'sleep 5',
    ]
    await fs.writeFile(script, lines.join('\n') + '\n', { mode: 0o700 })
    await exec('/usr/bin/defaults', ['write', 'com.apple.Terminal', 'AppleShowScrollBars', '-string', 'WhenScrolling'])
    await exec('/usr/bin/osascript', ['-e', 'tell application "Terminal" to set font size of settings set "Basic" to 12'])
    await exec('/usr/bin/open', ['-a', 'Terminal', script], { timeout: 20000 })
    await pause(1200)
    await exec('/usr/bin/osascript', ['-e', 'tell application "Terminal" to set font size of current settings of front window to 12'])
    await pause(400)
    await exec('/usr/bin/osascript', ['-e', 'tell application "Terminal" to set bounds of front window to {20, 105, 468, 785}'])
    await pause(400)
    stopped = false
    loop = captureFrames()
    await pause(400)
    hidePointer()
    cue('layout', 'shell')
    await expect.poll(async () => fs.access(scrolled).then(() => true, () => false), { timeout: 30000 }).toBe(true)
    await expect.poll(() => cli('eval', { pane: target, expression: 'scrollY' })).toBeGreaterThan(100)
    await expect.poll(async () => fs.access(done).then(() => true, () => false), { timeout: 60000 }).toBe(true)
    expect(await fs.readFile(extracted, 'utf8')).toMatch(/Show HN:/)
    await cli('zoom', { pane: target, factor: 1 })
    await pause(3500)

    }
    if (part === 'all' || part === 'parallel') {
      stopped = true
      await loop
      await exec('/usr/bin/killall', ['Terminal']).catch(() => undefined)
      await cli('switch-client', { client: client.id, session: agents.id })
      let model = (await cli('state')).model.clients.find((item: { id: string }) => item.id === client.id)
      if (model.zoomedPaneId) await cli('toggle-pane-zoom', { client: client.id })
      await app().evaluate(({ BaseWindow }, bounds) => BaseWindow.getAllWindows().find(item => item.isVisible())!.setBounds(bounds), initialBounds)
      stopped = false
      loop = captureFrames()
      cue('layout', 'parallel')
      await chapter('Control four panes at once')
      let panes = [first, right, lowerLeft, lowerRight]
      let send = async (pane: { id: string }, key: string) => {
        let command = `bmux key -t ${pane.id} ${key}`
        cue('command', command)
        let response = JSON.parse((await exec(process.execPath, [path.join(root, 'bin/bmux.mjs'), 'key', '-t', pane.id, key], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 30000 })).stdout)
        if (!response.ok) throw new Error(response.error)
      }
      for (let pane of panes) {
        workers.push((async () => {
          while (!stopAgents) {
            await send(pane, 'PageDown')
            await pause(1600)
            let atEnd = await cli('eval', { pane: pane.id, expression: 'scrollY + innerHeight >= document.documentElement.scrollHeight - 10' })
            if (atEnd) { await send(pane, 'Home'); await pause(600) }
          }
        })())
        await pause(1100)
      }
      await chapter('Monitor independent profiles')
      await pause(5500)
      stopAgents = true
      await Promise.all(workers)
    }
    if (part === 'all' || part === 'profiles') {
      await cli('switch-client', { client: client.id, session: agents.id })
    await chapter('Background profiles keep running')
    await cli('select-pane', { client: client.id, pane: first.id })
    await cli('client.overlay', { client: client.id, visible: true })
    chrome = await currentChrome()
    await click(chrome, chrome.getByRole('button', { name: 'Profile: DEV agent', exact: true }))
    let dialog = chrome.getByRole('dialog', { name: 'Profile', exact: true })
    await pause(2500)
    await chapter('Choose a proxy for each profile')
    await click(chrome, dialog.getByRole('button', { name: 'Proxy settings', exact: true }))
    dialog = chrome.getByRole('dialog', { name: 'Proxy', exact: true })
    await expect(dialog.getByRole('button', { name: 'Save proxy', exact: true })).toBeInViewport()
    await pause(800)
    await click(chrome, dialog.getByLabel('Protocol', { exact: true }))
    let fields = dialog.locator('[class*=proxyFields]')
    let protocolScroll = await fields.evaluate(element => {
      element.setAttribute('data-min-scroll', String(element.scrollTop))
      element.addEventListener('scroll', () => element.setAttribute('data-min-scroll', String(Math.min(Number(element.getAttribute('data-min-scroll')), element.scrollTop))))
      return element.scrollTop
    })
    await dialog.getByLabel('Protocol', { exact: true }).selectOption('http')
    await pause(1600)
    await expect(dialog.getByLabel('Protocol', { exact: true })).toHaveValue('http')
    expect(Number(await fields.getAttribute('data-min-scroll'))).toBeGreaterThanOrEqual(protocolScroll - 2)
    await click(chrome, dialog.getByLabel('Host', { exact: true }))
    hidePointer()
    await dialog.getByLabel('Host', { exact: true }).pressSequentially('127.0.0.1', { delay: 160 })
    await keys('Tab', { keyCode: 'Tab' })
    await keys('Cmd + A', { keyCode: 'a', modifiers: ['meta'] })
    await dialog.getByLabel('Port', { exact: true }).pressSequentially(String((server.address() as { port: number }).port), { delay: 180 })
    await pause(1200)
    await click(chrome, dialog.getByLabel('Proxy requires authentication'))
    await pause(1700)
    await click(chrome, dialog.getByRole('button', { name: 'Save proxy', exact: true }))
    await pause(800)
    await expect(dialog.getByRole('button', { name: 'Test connection', exact: true })).toBeInViewport()
    await click(chrome, dialog.getByRole('button', { name: 'Test connection', exact: true }))
    await expect(dialog.getByRole('status', { name: /Proxy test passed/ })).toBeVisible({ timeout: 15000 })
    await pause(5000)
    await click(chrome, dialog.getByRole('button', { name: 'Use system connection', exact: true }))
    await pause(900)
    await click(chrome, dialog.getByRole('button', { name: 'Close', exact: true }))
    await cli('client.overlay', { client: client.id, visible: false })

    }

    let duration = Number(((Date.now() - started) / 1000).toFixed(2))
    let scaleFactor = await app().evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor)
    await fs.writeFile(path.join(destination, 'timeline.json'), JSON.stringify({ source: options.publicPreview ? 'Public-site layout preview; Google Cloud sign-in pending; local proxy test' : 'Tart guest capture with a dedicated Google Cloud demo login; public agent sites; local proxy test', part, coordinateSpace: 'screen', crop: Object.fromEntries(Object.entries(initialBounds).map(([key, value]) => [key, Math.round(value * scaleFactor)])), scaleFactor, duration, cues, segments: [{ file: 'screen.mov', start: -1.8, end: duration }] }, null, 2))
  } finally {
    stopAgents = true
    await Promise.allSettled(workers)
    stopped = true
    if (loop) {
      await loop
      await fs.writeFile(path.join(destination, 'frames.json'), JSON.stringify(frames.map(frame => ({ file: path.basename(frame.file), at: frame.at }))))
    }
    await application?.close().catch(() => undefined)
    await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve())
    await fs.rm(directory, { recursive: true, force: true })
  }
  expect(frames.length).toBeGreaterThan(20)
})
