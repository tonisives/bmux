import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { initialModel, newPane, newSession, newWindow, splitLayout } from '../src/main/model'
import { writeModel } from '../src/main/store'
import { closeTestApplication } from './electron-fixture'

for (let crash of [false, true]) test(`restores the last focused client and its selected session, window and pane after ${crash ? 'a crash' : 'quitting'}`, async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-session-restore-'))
  let model = initialModel(), gp = model.sessions[0]
  gp.name = 'gp'
  for (let number = 2; number <= 6; number++) gp.windows.push(newWindow(`window-${number}`, gp.defaultProfileId, false, model))
  let window = gp.windows[5], pane = newPane(gp.defaultProfileId, 'about:blank', model)
  window.panes.push(pane)
  window.layout = splitLayout(window.layout, window.panes[0].id, pane.id, 'horizontal')
  let bot = newSession('bot', model.profiles[1].id, false, model)
  model.sessions.push(bot)
  let gpClient = { id: 'client_gp', sessionId: gp.id, windowId: window.id, paneId: pane.id, width: 1000, height: 700 }
  let botClient = { id: 'client_bot', sessionId: bot.id, windowId: bot.windows[0].id, paneId: bot.windows[0].panes[0].id, width: 1000, height: 700 }
  model.clients.push(gpClient, botClient)
  writeModel(directory, model)
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
  let application: ElectronApplication | undefined, child: ChildProcess | undefined
  let launch = async () => {
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    child = application.process()
    await expect.poll(() => application!.context().pages().filter(page => page.url().endsWith('/renderer/index.html')).length).toBe(2)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    return {
      state: () => chrome.evaluate(() => (globalThis as any).bmux.state()),
      command: (method: string, args: Record<string, unknown>) => chrome.evaluate(({ method, args }) => (globalThis as any).bmux.command({ method, args }), { method, args }),
    }
  }
  try {
    let browser = await launch()
    // Older state files have no focus reference and retain their existing fallback.
    await expect.poll(async () => (await browser.state()).focusedClientId).toBe(botClient.id)
    await browser.command('activate-client', { client: gpClient.id })
    await expect.poll(async () => (await browser.state()).focusedClientId).toBe(gpClient.id)
    expect((await browser.state()).configError).toBeNull()
    // Switching to another app before quitting must keep the last bmux selection.
    await application!.evaluate(({ BaseWindow }) => BaseWindow.getFocusedWindow()!.blur())
    await expect.poll(async () => (await browser.state()).focusedClientId).toBeNull()
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8')).lastFocusedClientId).toBe(gpClient.id)
    if (crash) child!.kill('SIGKILL')
    await closeTestApplication(application, child)
    application = undefined

    browser = await launch()
    await expect.poll(async () => (await browser.state()).focusedClientId).toBe(gpClient.id)
    let restored = await browser.state()
    expect(restored.model.clients.map((client: { id: string }) => client.id)).toEqual([gpClient.id, botClient.id])
    expect(restored.model.clients[0]).toMatchObject({ sessionId: gp.id, windowId: window.id, paneId: pane.id })
    expect(restored.model.sessions.find((session: { id: string }) => session.id === gp.id).windows.find((item: { id: string }) => item.id === window.id).number).toBe(6)
    expect(restored.model.clients[1]).toMatchObject({ sessionId: bot.id, windowId: botClient.windowId, paneId: botClient.paneId })
  } finally {
    await closeTestApplication(application, child)
    await fs.rm(directory, { recursive: true, force: true })
  }
})
