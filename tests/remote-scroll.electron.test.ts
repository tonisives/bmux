import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication, waitForControlStatus } from './electron-fixture'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { initialModel, newWindow } from '../src/main/model'

test('background wheel scrolling animates the addressed hidden pane', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-background-scroll-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(`<!doctype html><title>Background feed</title><style>html,body{margin:0;height:100%;overflow:hidden}main{position:absolute;inset:52px 0 0;overflow:auto}.posts{height:6000px;background:linear-gradient(#eee,#789)}</style><main><div class="posts">Feed</div></main><script>window.positions=[];window.wheels=[];let feed=document.querySelector('main');feed.addEventListener('scroll',()=>positions.push({y:feed.scrollTop,at:performance.now()}));feed.addEventListener('wheel',e=>wheels.push({delta:e.deltaY,trusted:e.isTrusted}),{passive:true});</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let model = initialModel(), session = model.sessions[0], profile = model.profiles[1]
  let first = session.windows[0]
  first.panes[0].profileId = profile.id
  first.panes[0].url = `${origin}/first`
  let second = newWindow('Second feed', profile.id, false, model)
  second.panes[0].url = `${origin}/second`
  session.windows.push(second)
  await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify(model))
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\nscrolling:\n  enabled: true\n  randomize: false\n  overshoot: false\nautomation:\n  safety:\n    enabled: false\n')
  let command = async (...args: string[]) => {
    let response = await promisify(execFile)(process.execPath, ['bin/bmux.mjs', ...args], { env: { ...process.env, BMUX_AGENT_ID: 'hidden-scroll-fixture', BMUX_DATA_DIR: directory }, timeout: 15000 })
    let value = JSON.parse(response.stdout)
    if (!value.ok) throw new Error(value.error)
    return value.result
  }
  try {
    application = await electron.launch({ args: [process.cwd(), '--background'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '1', BMUX_REMOTE_CONFIG: '', BMUX_REQUIRED_PROXY: '' } })
    await waitForControlStatus(command)
    for (let [window, pathname] of [[first, 'first'], [second, 'second']] as const) {
      let pane = window.panes[0].id
      await command('wait', '-t', pane, '--selector', 'main')
      await command('rpc', 'lock-viewport', JSON.stringify({ window: window.id, width: 1278, height: 792 }))
      await command('rpc', 'zoom', JSON.stringify({ pane, factor: pathname === 'first' ? 1 : .75 }))
      let page = application.context().pages().find(page => page.url() === `${origin}/${pathname}`)!
      await application.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url)!.setAudioMuted(true), page.url())
      let outcome = await command('rpc', 'cdp', JSON.stringify({ pane, method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: 600, y: 400, deltaX: 0, deltaY: 600 } }))
      expect(await page.evaluate(() => document.querySelector('main')!.scrollTop)).toBe(600)
      let positions = await page.evaluate(() => (window as any).positions as { y: number; at: number }[])
      expect(positions.length).toBeGreaterThan(1)
      expect(positions.at(-1)!.at - positions[0].at).toBeGreaterThan(0)
      let wheels = await page.evaluate(() => (window as any).wheels as { delta: number; trusted: boolean }[])
      expect(wheels.length).toBeGreaterThan(1)
      expect(wheels.every(wheel => wheel.trusted)).toBe(true)
      if (process.platform === 'linux') {
        expect(outcome.scroll.durationMs).toBeLessThan(1500)
        expect(positions.at(-1)!.at - positions[0].at).toBeLessThan(1500)
      }
      console.log(JSON.stringify({ pathname, scroll: outcome.scroll, frames: positions.length }))
      await command('rpc', 'cdp', JSON.stringify({ pane, method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: 600, y: 400, deltaX: 0, deltaY: -200 } }))
      expect(await page.evaluate(() => document.querySelector('main')!.scrollTop)).toBe(400)
    }
    for (let page of application.context().pages().filter(page => page.url().startsWith(origin))) expect(await page.evaluate(() => document.querySelector('main')!.scrollTop)).toBe(400)
    let diagnostics = await command('rpc', 'diagnostics', '{}')
    expect(diagnostics.visibleClients).toBe(0)
    expect(diagnostics.parkingWindows.every((window: any) => !window.visible)).toBe(true)
  } finally {
    await closeTestApplication(application)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
