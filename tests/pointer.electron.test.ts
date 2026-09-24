import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('pane shortcuts move the macOS pointer into page content, including zoomed panes', async () => {
  test.skip(process.platform !== 'darwin', 'Native pointer following is supported on macOS')
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-pointer-'))
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard:\n  shortcuts:\n    Cmd+H: pane-left\n    Cmd+J: pane-down\n    Cmd+K: pane-up\n    Cmd+L: pane-right\n')
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Pointer fixture</title><style>body{margin:0;height:3000px;background:#e8eef8}h1{padding:40px}</style><h1>Pointer fixture</h1>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let packaged = process.env.BMUX_TEST_PACKAGED === '1'
  let application = await electron.launch({
    ...(packaged ? { executablePath: path.resolve(process.env.BMUX_OUTPUT_DIR || 'build', 'bmux.app/Contents/MacOS/bmux') } : {}),
    args: packaged ? [] : [process.cwd()],
    env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' },
  })
  let originalPointer = await application.evaluate(({ screen }) => screen.getCursorScreenPoint())
  application.process().stderr?.on('data', chunk => { if (String(chunk).includes('bmux:')) console.log(String(chunk)) })
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = await chrome.evaluate(() => (window as any).bmux.state())
    let client = state.model.clients[0], left = state.model.sessions[0].windows[0].panes[0]
    await rpc('navigate', { tab: left.id, url: `${url}/left` })
    let right = await rpc('split-window', { pane: left.id, url: `${url}/right` })
    let lower = await rpc('split-window', { pane: right.id, axis: 'vertical', url: `${url}/lower` })
    await rpc('wait', { tab: lower.id, selector: 'h1' })
    await rpc('activate-client', { client: client.id })
    await rpc('select-pane', { client: client.id, pane: left.id })
    await rpc('focus-page', { client: client.id })
    let cursor = () => application.evaluate(({ screen }) => screen.getCursorScreenPoint())
    let key = (keyCode: string, modifiers: Electron.KeyboardInputEvent['modifiers'] = ['meta']) => application.evaluate(({ webContents }, { keyCode, modifiers }) => {
      let contents = webContents.getFocusedWebContents()!
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      if (['h', 'j', 'k', 'l'].includes(keyCode) && modifiers?.includes('meta')) contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [...modifiers, 'isautorepeat'] })
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    }, { keyCode, modifiers })
    let expectPointer = async (paneId: string) => {
      await expect(chrome.locator(`[data-pane-id="${paneId}"]`)).toHaveAttribute('data-focused-pane', 'true')
      let content = chrome.locator(`[data-pane-id="${paneId}"] [data-browser-content]`)
      await expect(content).toBeVisible()
      let bounds = (await content.boundingBox())!
      let origin = await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find(window => window.isFocused())!.getContentBounds())
      await expect.poll(cursor).toEqual({ x: Math.round(origin.x + bounds.x + bounds.width / 2), y: Math.round(origin.y + bounds.y + bounds.height / 2) })
    }
    for (let [shortcut, pane] of [['l', right], ['j', lower], ['k', right], ['h', left]] as const) {
      await key(shortcut)
      await expectPointer(pane.id)
    }
    // No neighbor, and explicit automation selections, must not warp the pointer.
    let before = await cursor()
    await key('h')
    await rpc('select-pane', { client: client.id, pane: right.id })
    expect(await cursor()).toEqual(before)
    await rpc('toggle-pane-zoom', { client: client.id })
    await expect(chrome.locator('[data-pane-id]')).toHaveCount(1)
    await key('j')
    await expectPointer(lower.id)
    await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${url}/lower`)
    await key('Down', [])
    await expect.poll(() => rpc('eval', { tab: lower.id, expression: 'scrollY' })).toBeGreaterThan(0)
    await rpc('toggle-pane-zoom', { client: client.id })
    await expect(chrome.locator('[data-pane-id]')).toHaveCount(3)
    await key('b', ['control']); await key('o', [])
    await expectPointer(left.id)
    // Clicking the URL bar selects its pane without recentering the real pointer.
    before = await cursor()
    await chrome.locator(`[data-pane-id="${right.id}"]`).getByRole('button', { name: 'Address', exact: true }).click()
    await expect(chrome.getByRole('textbox', { name: 'URL or search', exact: true })).toBeFocused()
    expect(await cursor()).toEqual(before)
    // Even an explicit pointer request is ignored when the client is not foreground.
    await application.evaluate(({ app }) => app.hide())
    await expect.poll(() => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().some(window => window.isFocused()))).toBe(false)
    before = await cursor()
    await rpc('select-pane', { client: client.id, pane: lower.id, movePointer: true })
    expect(await cursor()).toEqual(before)
  } catch (error) {
    console.log('POINTER_DIAGNOSTICS', await application.evaluate(({ BaseWindow, screen, webContents }) => ({ pointer: screen.getCursorScreenPoint(), focused: webContents.getFocusedWebContents()?.getURL(), windows: BaseWindow.getAllWindows().map(window => ({ id: window.id, focused: window.isFocused(), bounds: window.getContentBounds() })) })))
    throw error
  } finally {
    await promisify(execFile)(process.execPath, ['-e', 'require(process.argv[1]).move(Number(process.argv[2]), Number(process.argv[3]))', path.join(process.cwd(), 'out/native/pointer.node'), String(originalPointer.x), String(originalPointer.y)])
    await application.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
