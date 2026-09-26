import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { initialModel, newSession, newWindow } from '../src/main/model'

let application: ElectronApplication, chrome: Page, page: Page, directory: string, url: string, server: http.Server
let model = initialModel(), session = model.sessions[0], pane = session.windows[0].panes[0], original = pane.id
let docsWindow = newWindow('docs', pane.profileId), notesWindow = newWindow('notes', pane.profileId)
let exec = promisify(execFile)
let state = () => chrome.evaluate(() => (window as any).bmux.state())
let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let cli = async (...args: string[]) => {
  let result = await exec(process.execPath, [path.resolve('bin/bmux.mjs'), ...args], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml') }, timeout: 20000 }).catch(error => ({ stdout: error.stdout }))
  let response = JSON.parse(result.stdout)
  if (!response.ok) throw new Error(response.error)
  return response.result
}
let activate = async () => {
  let current = await state()
  if (current.focusedClientId !== current.clientId) await rpc('activate-client', { client: current.clientId })
  await expect.poll(async () => (await state()).focusedClientId).toBe(current.clientId)
}
let open = async (command: string) => {
  await activate(); await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click()
  let input = chrome.getByRole('combobox', { name: 'Command', exact: true }); await input.fill(command); await input.press('Enter')
}
let openFind = async () => {
  await activate(); await rpc('focus-page', { client: (await state()).clientId })
  await application.evaluate(({ webContents }) => {
    let contents = webContents.getFocusedWebContents()!
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'f', modifiers: ['meta'] })
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'f', modifiers: ['meta'] })
  })
  await expect(chrome.getByRole('textbox', { name: 'Find in page', exact: true })).toBeFocused()
}
let flattenBookmarks = (bookmarks: any[]): any[] => bookmarks.flatMap(bookmark => [bookmark, ...flattenBookmarks(bookmark.children ?? [])])

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-search-wait-'))
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    let title = request.url === '/docs' ? 'Documentation' : request.url === '/notes' ? 'Research notes' : 'Search fixture'
    response.end(`<!doctype html><title>${title}</title><style>body{font:24px sans-serif;background:#e8eef8;color:#173353;padding:30px}p{margin:32px 0}</style><h1>${title}</h1><p>First lantern</p><p>Second lantern</p><p>Third lantern</p><div id="ready" hidden>Ready</div><div id="offscreen" style="position:absolute;top:3000px">Offscreen</div><div data-label="a'b">Quoted selector</div>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${(server.address() as any).port}`
  docsWindow.panes[0].url = `${url}/docs`; docsWindow.panes[0].title = 'Documentation'
  notesWindow.panes[0].url = `${url}/notes`; notesWindow.panes[0].title = 'Research notes'
  session.windows.push(docsWindow, notesWindow)
  model.profiles[0].bookmarks = [{ id: 'work', title: 'Work', children: [{ id: 'docs', title: 'Guides', children: [
    { id: 'api', title: 'API reference', url: `${url}/docs` }, { id: 'unsupported', title: 'Disabled bookmarklet', url: 'javascript:void(0)' },
  ] }, { id: 'notes', title: 'Research notes', url: `${url}/notes` },
  { id: 'sessions', title: 'Sessions', url: `${url}/sessions` },
  { id: 'suggestions', title: 'Search suggestions', url: `${url}/suggestions` },
  { id: 'parameterized', title: 'Parameterized search', url: `${url}/search?q=original&limit=10&tracking=1` },
  { id: 'x-ideas', title: 'X ideas', url: 'https://x.com/search?q=startup&f=live' },
  { id: 'url-only', title: 'Other page', url: `${url}/sessions/other` }] }]
  model.profiles[1].bookmarks = [{ id: 'bot-docs', title: 'Bot-only docs', url: `${url}/bot` }]
  model.profiles[0].history = [{ title: 'Research notes', url: `${url}/notes`, visitedAt: Date.parse('2026-01-02T03:04:00Z') }]
  model.profiles[1].history = [{ title: 'Bot-only visit', url: `${url}/bot`, visitedAt: Date.parse('2026-01-01T03:04:00Z') }]
  model.sessions.push(newSession('Project planning', model.profiles[1].id))
  for (let index = 0; index < 24; index++) model.sessions.push(newSession(`Scroll fixture ${index + 1}`, model.profiles[0].id))
  await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify(model))
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
  await fs.writeFile(path.join(directory, 'bookmark-parameters.yaml'), JSON.stringify({ profiles: { profile_default: { 'x-ideas': { values: { q: 'startup min_faves:1 min_replies:1' }, hidden: [] } } } }))
  application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  expect((await state()).configError).toBeNull()
  expect((await state()).model.profiles[0].bookmarks).toEqual(model.profiles[0].bookmarks)
  expect(await fs.readFile(path.join(directory, 'bookmarks.yaml'), 'utf8')).toContain('API reference')
  await activate(); await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true }); await address.fill(`${url}/fixture`); await address.press('Enter')
  await expect.poll(() => application.context().pages().some(page => page.url() === `${url}/fixture`)).toBe(true)
  page = application.context().pages().find(page => page.url() === `${url}/fixture`)!
  await expect(page.locator('h1')).toHaveText('Search fixture')
  await fs.mkdir(path.resolve('artifacts'), { recursive: true })
})
test.beforeEach(async () => {
  await chrome.keyboard.press('Escape'); await chrome.keyboard.press('Escape')
  await rpc('switch-client', { client: (await state()).clientId, session: session.id })
  await rpc('navigate', { pane: original, url: `${url}/fixture` }); await activate()
})
test.afterAll(async () => {
  await application?.close()
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  if (directory) await fs.rm(directory, { recursive: true, force: true })
})

test('session search filters by name without changing selection until confirmed', async () => {
  await open('sessions')
  let sessions = chrome.getByRole('group', { name: 'Choose session', exact: true }), sessionSearch = sessions.getByRole('textbox', { name: 'Search sessions', exact: true })
  let sessionRows = sessions.locator('button[data-session-row]')
  await chrome.keyboard.press('p'); await expect(sessionSearch).toBeFocused(); await expect(sessionSearch).toHaveValue('p')
  await sessionSearch.fill('pjct pln'); await expect(sessionRows).toHaveCount(1)
  expect((await state()).model.clients[0].sessionId).toBe(session.id)
  await sessionSearch.press('Enter'); await expect(sessions).toHaveCount(0)
  expect((await state()).model.clients[0].sessionId).toBe(model.sessions[1].id)
})

test('session picker creates and attaches sessions with default names', async () => {
  await open('sessions')
  let sessions = chrome.getByRole('group', { name: 'Choose session', exact: true })
  let create = sessions.getByRole('button', { name: 'new session', exact: true })
  await expect(sessions.getByRole('button').last()).toHaveText('new private session')
  await create.click()
  await chrome.getByRole('form', { name: 'New session' }).getByRole('button', { name: 'Create session' }).click()
  await expect(sessions).toHaveCount(0)
  let current = await state(), client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)
  expect(current.model.sessions.find((item: { id: string; name: string }) => item.id === client?.sessionId)?.name).toBe('session-1')
  await open('sessions')
  await chrome.getByRole('group', { name: 'Choose session', exact: true }).getByRole('button', { name: 'new session', exact: true }).click()
  await chrome.getByRole('form', { name: 'New session' }).getByRole('button', { name: 'Create session' }).click()
  current = await state(); client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)
  expect(current.model.sessions.find((item: { id: string; name: string }) => item.id === client?.sessionId)?.name).toBe('session-2')
})

test('session picker goes back to the previously selected session', async () => {
  let client = (await state()).clientId, previous = model.sessions[1]
  await rpc('switch-client', { client, session: previous.id })
  await rpc('switch-client', { client, session: session.id })
  await open('sessions')
  let panel = chrome.getByRole('dialog', { name: 'Sessions', exact: true })
  let sessions = panel.getByRole('group', { name: 'Choose session', exact: true })
  let search = sessions.getByRole('textbox', { name: 'Search sessions', exact: true })
  await search.fill('go back')
  let back = sessions.getByRole('button', { name: `go back: ${previous.name}`, exact: true })
  await expect(sessions.locator('button[data-session-row]')).toHaveCount(0)
  await back.click()
  await expect(panel).toHaveCount(0)
  expect((await state()).model.clients.find((item: { id: string }) => item.id === client).sessionId).toBe(previous.id)
})

test('session picker creates a private session with an indicator', async () => {
  let extensionPath = path.join(directory, 'private-layout-extension')
  await fs.mkdir(extensionPath)
  await fs.writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Private layout fixture', version: '1.0' }))
  let extension = await rpc('extension.load', { profile: pane.profileId, path: extensionPath })
  await open('sessions')
  let picker = chrome.getByRole('group', { name: 'Choose session', exact: true })
  await picker.getByRole('button', { name: 'new private session', exact: true }).click()
  await chrome.getByRole('form', { name: 'New private session' }).getByRole('button', { name: 'Create private session' }).click()
  await expect(picker).toHaveCount(0)
  let current = await state()
  let privateSession = current.model.sessions.find((item: { name: string }) => item.name === 'private-1')
  expect(privateSession.private).toBe(true)
  await expect(chrome.getByRole('button', { name: 'Sessions', exact: true }).getByRole('img', { name: 'Private session' })).toBeVisible()
  let tabId = privateSession.windows[0].panes[0].id
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await expect(address).toBeFocused()
  await address.pressSequentially(`${url}/private-visit`)
  await address.press('Enter')
  await expect.poll(async () => (await state()).model.sessions.find((item: { id: string }) => item.id === privateSession.id).windows[0].panes[0].url).toBe(`${url}/private-visit`)
  let expectedBounds = await chrome.locator(`[data-content-pane-id="${tabId}"]`).evaluate(element => {
    let rect = element.getBoundingClientRect()
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
  })
  expect(expectedBounds.y).toBeGreaterThan(28)
  await expect.poll(() => application.evaluate(({ BaseWindow }, target) => {
    let view = BaseWindow.getAllWindows().filter(window => window.isVisible()).flatMap(window => window.contentView.children).find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === target)
    return view?.getBounds()
  }, `${url}/private-visit`)).toEqual(expectedBounds)
  expect((await state()).model.profiles[0].history.some((entry: { url: string }) => entry.url === `${url}/private-visit`)).toBe(false)
  let isolated = await application.evaluate(async ({ session }, { privateId, origin }) => {
    let privateBrowser = session.fromPartition(`private:${privateId}:profile_default`)
    await privateBrowser.cookies.set({ url: origin, name: 'private-test', value: 'only-private' })
    return { privateCookies: await privateBrowser.cookies.get({ url: origin }), regularCookies: await session.fromPartition('persist:profile_default').cookies.get({ url: origin }) }
  }, { privateId: privateSession.id, origin: url })
  expect(isolated.privateCookies.some(cookie => cookie.name === 'private-test')).toBe(true)
  expect(isolated.regularCookies.some(cookie => cookie.name === 'private-test')).toBe(false)
  await expect.poll(async () => fs.readFile(path.join(directory, 'state.json'), 'utf8').then(text => text.includes(privateSession.id))).toBe(false)
  await open('sessions')
  await expect(chrome.getByRole('group', { name: 'Choose session' }).getByRole('button', { name: 'private-1' }).getByRole('img', { name: 'Private session' })).toBeVisible()
  await chrome.keyboard.press('Escape')
  await rpc('extension.remove', { profile: pane.profileId, id: extension.id })
})

test('general search app choices apply to normal and private sessions', async () => {
  await open('settings')
  let settings = chrome.getByRole('dialog', { name: 'Settings', exact: true })
  let normal = settings.getByRole('combobox', { name: 'Normal session search app' })
  let privateApp = settings.getByRole('combobox', { name: 'Private session search app' })
  await expect(normal).toHaveValue('google')
  await expect(privateApp).toHaveValue('google')
  await normal.selectOption('duckduckgo')
  await privateApp.selectOption('brave')
  await expect.poll(async () => (await state()).searchApps).toEqual({ normal: 'duckduckgo', private: 'brave' })
  await expect.poll(async () => fs.readFile(path.join(directory, 'config.yaml'), 'utf8')).toContain('normal: duckduckgo')
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  let regular = await rpc('navigate', { tab: original, url: 'cats & dogs', waitUntil: 'none' }) as { url: string }
  expect(regular.url).toBe('https://duckduckgo.com/?q=cats%20%26%20dogs')

  let privateSession = await rpc('new-session', { private: true, client: (await state()).clientId }) as { id: string; windows: { panes: { id: string }[] }[] }
  let privateSearch = await rpc('navigate', { tab: privateSession.windows[0].panes[0].id, url: 'cats & dogs', waitUntil: 'none' }) as { url: string }
  expect(privateSearch.url).toBe('https://search.brave.com/search?q=cats%20%26%20dogs')
  await expect.poll(async () => fs.readFile(path.join(directory, 'state.json'), 'utf8').then(text => text.includes(privateSession.id))).toBe(false)
  await rpc('switch-client', { client: (await state()).clientId, session: session.id })
  await open('settings')
  settings = chrome.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('combobox', { name: 'Normal session search app' }).selectOption('google')
  await settings.getByRole('combobox', { name: 'Private session search app' }).selectOption('google')
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
})

test('session picker creates by keyboard and confirms session closing', async () => {
  await open('sessions')
  let sessions = chrome.getByRole('group', { name: 'Choose session', exact: true })
  let create = sessions.getByRole('button', { name: 'new session', exact: true })
  await chrome.keyboard.press('End'); await expect(sessions.getByRole('button', { name: 'new private session', exact: true })).toBeFocused()
  await chrome.keyboard.press('ArrowUp'); await expect(create).toBeFocused()
  await chrome.keyboard.press('Enter'); await chrome.getByRole('form', { name: 'New session' }).getByRole('button', { name: 'Create session' }).click(); await expect(sessions).toHaveCount(0)
  let current = await state(), created = current.model.sessions.find((item: { name: string }) => item.name === 'session-3')
  expect(current.model.clients.find((item: { id: string }) => item.id === current.clientId).sessionId).toBe(created.id)
  await open('sessions')
  sessions = chrome.getByRole('group', { name: 'Choose session', exact: true })
  let close = sessions.getByRole('button', { name: 'Close session session-3', exact: true })
  await close.click()
  let confirmation = sessions.getByRole('alertdialog', { name: 'Close session session-3?', exact: true })
  await expect(confirmation).toBeVisible(); await confirmation.getByRole('button', { name: 'no', exact: true }).click()
  await close.click(); await confirmation.getByRole('button', { name: 'yes', exact: true }).click()
  await expect.poll(async () => (await state()).model.sessions.some((session: { name: string }) => session.name === 'session-3')).toBe(false)
})

test('picker arrows wrap between the first and last rows', async () => {
  await open('sessions')
  let panel = chrome.getByRole('dialog', { name: 'Sessions', exact: true })
  let rows = panel.getByRole('group', { name: 'Choose session', exact: true }).locator('button:not([data-picker-action])')
  let scroll = () => panel.evaluate(element => ({ top: element.scrollTop, bottom: element.scrollHeight - element.clientHeight }))
  await chrome.keyboard.press('End')
  await expect(rows.last()).toBeFocused()
  await chrome.keyboard.press('ArrowDown')
  await expect(rows.first()).toBeFocused()
  await expect.poll(async () => (await scroll()).top).toBe(0)
  await chrome.keyboard.press('ArrowUp')
  await expect(rows.last()).toBeFocused()
  await expect.poll(async () => { let position = await scroll(); return position.bottom - position.top }).toBeLessThan(2)
  await chrome.keyboard.press('Home')
  await expect(rows.first()).toBeFocused()
  await chrome.keyboard.press('ArrowUp')
  await expect(rows.last()).toBeFocused()
})

test('bookmark arrows wrap across visible selectable rows', async () => {
  await open('bookmarks')
  let group = chrome.getByRole('group', { name: 'Choose bookmark', exact: true })
  let rows = group.locator('button[data-bookmark-id]:not(:disabled)')
  let search = group.getByRole('textbox', { name: 'Search bookmarks', exact: true })
  await search.press('ArrowUp')
  await expect(rows.last()).toBeFocused()
  await chrome.keyboard.press('ArrowDown')
  await expect(rows.first()).toBeFocused()
  await chrome.keyboard.press('ArrowUp')
  await expect(rows.last()).toBeFocused()
})

test('bookmark search preserves folders, excludes other profiles, and keeps unsupported URLs disabled', async () => {
  await open('bookmarks')
  let group = chrome.getByRole('group', { name: 'Choose bookmark', exact: true }), search = group.getByRole('textbox', { name: 'Search bookmarks', exact: true })
  await expect(search).toBeFocused(); await search.fill('api reference')
  await expect(group.locator('summary')).toHaveText(['Work', 'Guides'])
  await expect(group.getByRole('button')).toHaveText(['API reference'])
  await search.fill('sessions'); await expect(group.getByRole('button')).toHaveText(['Sessions', 'Other page'])
  await search.fill('bot-only'); await expect(group.getByRole('status')).toHaveText('No matching bookmarks.')
  await search.fill('bookmarklet'); await expect(group.getByRole('button')).toBeDisabled()
  await search.press('Enter'); await expect(group).toBeVisible()
  await search.press('Escape'); await expect(group).toBeVisible(); await expect(search).toHaveValue('')
  await search.fill('guides'); await expect(group.locator('summary')).toHaveText(['Work', 'Guides']); await expect(group.getByRole('button')).toHaveCount(0)
  await search.fill('API reference')
  await chrome.screenshot({ path: path.resolve('artifacts/bookmark-search.png') })
  await search.press('ArrowDown'); await expect(group.getByRole('button', { name: 'API reference', exact: true })).toBeFocused()
  let before = (await state()).model.sessions[0].windows.length
  await chrome.keyboard.press('Enter'); await expect(group).toHaveCount(0)
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${url}/docs`)
  let after = await state()
  expect(after.model.sessions[0].windows).toHaveLength(before + 1)
  expect(after.model.sessions[0].windows.find((item: { id: string }) => item.id === after.model.clients.find((item: { id: string }) => item.id === after.clientId).windowId).panes[0].url).toBe(`${url}/docs`)
  expect((await state()).model.sessions[0].windows[0].panes[0].profileId).toBe('profile_default')

  await open('bookmarks')
  let newGroup = chrome.getByRole('group', { name: 'Choose bookmark', exact: true }), newSearch = newGroup.getByRole('textbox', { name: 'Search bookmarks', exact: true })
  await expect(newSearch).toHaveValue('API reference')
  await newSearch.fill('API reference')
  let beforeMetaEnter = (await state()).model.sessions[0].windows.length
  await newSearch.press('Meta+Enter')
  await expect(newGroup).toHaveCount(0)
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${url}/docs`)
  let afterMetaEnter = await state()
  expect(afterMetaEnter.model.sessions[0].windows).toHaveLength(beforeMetaEnter + 1)
  expect(afterMetaEnter.model.sessions[0].windows.find((item: { id: string }) => item.id === afterMetaEnter.model.clients.find((item: { id: string }) => item.id === afterMetaEnter.clientId).windowId).panes[0].url).toBe(`${url}/docs`)

  await open('bookmarks')
  let remembered = chrome.getByRole('textbox', { name: 'Search bookmarks', exact: true })
  await expect(remembered).toHaveValue('API reference')
  await remembered.press('Escape'); await expect(remembered).toHaveValue('')
  await chrome.getByRole('dialog', { name: 'Bookmarks', exact: true }).getByRole('button', { name: 'Close' }).click()
  await open('bookmarks')
  await expect(chrome.getByRole('textbox', { name: 'Search bookmarks', exact: true })).toHaveValue('')
  await chrome.getByRole('textbox', { name: 'Search bookmarks', exact: true }).fill('API reference')
  await rpc('switch-client', { client: (await state()).clientId, session: model.sessions[1].id })
  await open('bookmarks')
  await expect(chrome.getByRole('textbox', { name: 'Search bookmarks', exact: true })).toHaveValue('')
  await rpc('switch-client', { client: (await state()).clientId, session: session.id })
  await open('bookmarks')
  await expect(chrome.getByRole('textbox', { name: 'Search bookmarks', exact: true })).toHaveValue('API reference')
})

test('bookmark parameter controls customize the opened URL and persist removed keys', async () => {
  await open('bookmarks')
  let group = chrome.getByRole('group', { name: 'Choose bookmark', exact: true })
  await group.getByRole('textbox', { name: 'Search bookmarks', exact: true }).fill('Parameterized search')
  let bookmark = group.getByRole('button', { name: 'Parameterized search', exact: true })
  let customize = group.getByRole('button', { name: 'Customize Parameterized search' })
  await customize.click()
  await expect(bookmark).toHaveAttribute('data-active', 'true')
  await expect(bookmark).toHaveCSS('background-color', 'rgb(52, 71, 56)')
  await expect(customize).toHaveCSS('background-color', 'rgb(52, 71, 56)')
  await group.getByRole('textbox', { name: 'q', exact: true }).fill('new words')
  await group.getByRole('spinbutton', { name: 'limit', exact: true }).fill('25')
  await expect(group.getByRole('slider', { name: 'limit slider' })).toHaveValue('25')
  await group.getByRole('button', { name: 'Remove tracking parameter' }).click()
  await expect(group.getByRole('textbox', { name: 'tracking' })).toHaveCount(0)
  await group.getByRole('button', { name: 'Open', exact: true }).click()
  await expect.poll(async () => {
    let current = await state()
    return current.model.sessions[0].windows.find((item: { id: string }) => item.id === current.model.clients.find((item: { id: string }) => item.id === current.clientId).windowId).panes[0].url
  }).toBe(`${url}/search?q=new+words&limit=25`)
  let stored = await fs.readFile(path.join(directory, 'bookmark-parameters.yaml'), 'utf8')
  expect(stored).toContain('tracking')
  expect(stored).toContain('new words')
  await open('bookmarks')
  group = chrome.getByRole('group', { name: 'Choose bookmark', exact: true })
  await group.getByRole('textbox', { name: 'Search bookmarks', exact: true }).fill('Parameterized search')
  await group.getByRole('button', { name: 'Customize Parameterized search' }).click()
  await expect(group.getByRole('textbox', { name: 'q', exact: true })).toHaveValue('new words')
  await expect(group.getByRole('button', { name: 'Remove tracking parameter' })).toHaveCount(0)
})

test('X search minimum operators have separate numeric bookmark controls', async () => {
  await open('bookmarks')
  let group = chrome.getByRole('group', { name: 'Choose bookmark', exact: true })
  await group.getByRole('textbox', { name: 'Search bookmarks', exact: true }).fill('X ideas')
  await group.getByRole('button', { name: 'Customize X ideas' }).click()
  await expect(group.getByRole('spinbutton', { name: 'Min likes' })).toHaveValue('1')
  await expect(group.getByRole('spinbutton', { name: 'Min replies' })).toHaveValue('1')
  await expect(group.getByRole('textbox', { name: 'Results' })).toHaveValue('live')
  await expect(group.getByRole('spinbutton', { name: 'Post age (days)' })).toHaveValue('0')
  await expect(group.getByRole('slider', { name: 'Post age (days) slider' })).toHaveValue('0')
  await expect(group.getByRole('spinbutton', { name: 'Min views' })).toHaveCount(0)
  await group.getByRole('spinbutton', { name: 'Min likes' }).fill('25')
  await group.getByRole('spinbutton', { name: 'Min replies' }).focus()
  await expect.poll(async () => (await state()).bookmarkParameters.profile_default['x-ideas'].values['x:min_faves']).toBe('25')
  await group.getByRole('button', { name: 'Remove Min replies parameter' }).click()
  await expect(group.getByRole('spinbutton', { name: 'Min replies' })).toHaveCount(0)
  await expect.poll(async () => (await state()).bookmarkParameters.profile_default['x-ideas'].hidden).toContain('x:min_replies')
})

test('editing another bookmark clears the previous highlight and keeps the config button spaced', async () => {
  await open('bookmarks')
  let group = chrome.getByRole('group', { name: 'Choose bookmark', exact: true })
  await group.getByRole('textbox', { name: 'Search bookmarks', exact: true }).fill('')
  let first = group.getByRole('button', { name: 'Parameterized search', exact: true })
  let second = group.getByRole('button', { name: 'X ideas', exact: true })
  let firstConfig = group.getByRole('button', { name: 'Customize Parameterized search' })
  let secondConfig = group.getByRole('button', { name: 'Customize X ideas' })
  await firstConfig.click()
  await expect(first).toHaveAttribute('data-active', 'true')
  await expect(firstConfig.locator('..')).toHaveCSS('gap', '6px')
  await secondConfig.click()
  await expect(first).toHaveAttribute('data-active', 'false')
  await expect(firstConfig).toHaveAttribute('aria-expanded', 'false')
  await expect(second).toHaveAttribute('data-active', 'true')
  await expect(secondConfig).toHaveAttribute('aria-expanded', 'true')
})

test('search highlights only the focused bookmark or its open parameter editor', async () => {
  await open('bookmarks')
  let group = chrome.getByRole('group', { name: 'Choose bookmark', exact: true })
  let search = group.getByRole('textbox', { name: 'Search bookmarks', exact: true })
  await search.fill('search')
  let rows = group.locator('button[data-bookmark-id]')
  let editorBookmark = group.getByRole('button', { name: 'X ideas', exact: true })
  let highlightedRows = () => rows.evaluateAll(buttons => buttons.filter(button => ['rgb(48, 57, 68)', 'rgb(52, 71, 56)'].includes(getComputedStyle(button).backgroundColor)).map(button => button.dataset.bookmarkId))
  await expect(rows.first()).toHaveAttribute('data-search-selected', 'true')
  await expect.poll(highlightedRows).toEqual([await rows.first().getAttribute('data-bookmark-id')])
  await group.getByRole('button', { name: 'Customize X ideas' }).click()
  await search.hover()
  await expect(rows.first()).toHaveAttribute('data-search-selected', 'false')
  await expect(editorBookmark).toHaveAttribute('data-active', 'true')
  await expect.poll(highlightedRows).toEqual(['x-ideas'])
  await search.focus()
  await expect(editorBookmark).toHaveAttribute('data-active', 'false')
  await expect(rows.first()).toHaveAttribute('data-search-selected', 'true')
  await expect.poll(highlightedRows).toEqual([await rows.first().getAttribute('data-bookmark-id')])
  await search.press('ArrowDown')
  await expect(rows.nth(1)).toBeFocused()
  await expect(rows.first()).toHaveAttribute('data-search-selected', 'false')
  await expect(rows.nth(1)).toHaveCSS('outline-style', 'none')
  await expect.poll(highlightedRows).toEqual([await rows.nth(1).getAttribute('data-bookmark-id')])
  await chrome.keyboard.press('ArrowDown')
  await expect(rows.nth(2)).toBeFocused()
  await expect(rows.first()).toHaveAttribute('data-search-selected', 'false')
  await expect.poll(highlightedRows).toEqual([await rows.nth(2).getAttribute('data-bookmark-id')])
  await chrome.keyboard.press('ArrowUp')
  await chrome.keyboard.press('ArrowUp')
  await expect(rows.first()).toBeFocused()
  await expect(rows.first()).toHaveCSS('outline-style', 'none')
  await rows.first().hover()
  await expect(rows.first()).toHaveCSS('outline-style', 'none')
  await expect.poll(highlightedRows).toEqual([await rows.first().getAttribute('data-bookmark-id')])
})

test('mouse hover and arrow keys share one visible bookmark highlight', async () => {
  await open('bookmarks')
  let group = chrome.getByRole('group', { name: 'Choose bookmark', exact: true })
  let search = group.getByRole('textbox', { name: 'Search bookmarks', exact: true })
  await search.fill('')
  let rows = group.locator('button[data-bookmark-id]:not(:disabled)')
  let highlightedRows = () => rows.evaluateAll(buttons => buttons.filter(button => ['rgb(48, 57, 68)', 'rgb(52, 71, 56)'].includes(getComputedStyle(button).backgroundColor)).map(button => button.dataset.bookmarkId))
  await search.press('ArrowDown')
  await expect(rows.first()).toBeFocused()
  await rows.nth(1).hover()
  await expect.poll(highlightedRows).toEqual([await rows.nth(1).getAttribute('data-bookmark-id')])
  await chrome.keyboard.press('ArrowDown')
  await chrome.keyboard.press('ArrowDown')
  await expect(rows.nth(2)).toBeFocused()
  await expect.poll(highlightedRows).toEqual([await rows.nth(2).getAttribute('data-bookmark-id')])
  await search.fill('search')
  await rows.nth(2).hover()
  await expect.poll(highlightedRows).toEqual([await rows.nth(2).getAttribute('data-bookmark-id')])
  await search.press('ArrowDown')
  await expect(rows.nth(1)).toBeFocused()
  await expect(rows.nth(1)).toHaveCSS('outline-style', 'none')
  await expect.poll(highlightedRows).toEqual([await rows.nth(1).getAttribute('data-bookmark-id')])
})

test('history search stays profile scoped and opens a result in the selected pane', async () => {
  await open('history')
  let group = chrome.getByRole('group', { name: 'Choose history entry', exact: true }), search = group.getByRole('textbox', { name: 'Search history', exact: true })
  await expect(search).toBeFocused(); await search.fill('research notes')
  await expect(group.locator('button:not([data-picker-action])')).toHaveCount(1)
  await search.fill('bot-only'); await expect(group.getByRole('status')).toHaveText('No matching history.')
  await search.press('Escape'); await expect(search).toHaveValue('')
  await search.fill('research notes'); await search.press('Enter')
  await expect(group).toHaveCount(0)
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${url}/notes`)
  await rpc('navigate', { tab: original, url: `${url}/fixture` })
})

test('URL search closes on X or page click and removes individual history results', async () => {
  let visited = `${url}/remove-history-test`
  await rpc('navigate', { tab: original, url: visited })
  await expect.poll(async () => (await state()).model.profiles[0].history.some((entry: { url: string }) => entry.url === visited)).toBe(true)
  await rpc('navigate', { tab: original, url: `${url}/fixture` })
  let openAddress = async () => chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await openAddress()
  await expect(chrome.getByRole('button', { name: 'Close URL search' })).toBeVisible()
  await chrome.getByRole('button', { name: 'Close URL search' }).click()
  await expect(address).toHaveCount(0)

  await openAddress()
  await address.fill('remove-history-test')
  await expect(chrome.getByRole('listbox', { name: 'Address suggestions' }).getByRole('option', { name: new RegExp('remove-history-test') })).toBeVisible()
  await chrome.locator('[data-browser-content]').click({ position: { x: 20, y: 400 } })
  await expect(address).toHaveCount(0)

  await openAddress()
  await address.fill('remove-history-test')
  await chrome.getByRole('listbox', { name: 'Address suggestions' }).getByRole('button', { name: 'Remove Search fixture from history' }).click()
  await expect.poll(async () => (await state()).model.profiles[0].history.some((entry: { url: string }) => entry.url === visited)).toBe(false)
  await expect(chrome.getByRole('listbox', { name: 'Address suggestions' })).toHaveCount(0)
  await expect(address).toBeFocused()

  await rpc('navigate', { tab: original, url: visited })
  await rpc('navigate', { tab: original, url: `${url}/fixture` })
  await open('history')
  let group = chrome.getByRole('group', { name: 'Choose history entry', exact: true })
  await group.getByRole('textbox', { name: 'Search history' }).fill('remove-history-test')
  await group.getByRole('button', { name: 'Remove Search fixture from history' }).click()
  await expect(group.getByRole('status')).toHaveText('No matching history.')
  await expect.poll(async () => JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8')).profiles[0].history.some((entry: { url: string }) => entry.url === visited)).toBe(false)
})

test('bookmark command searches and creates folders while Command+D updates and moves the same URL', async () => {
  await open('bookmark')
  let editor = chrome.getByRole('dialog', { name: 'Bookmark', exact: true })
  let title = editor.getByRole('textbox', { name: 'Title', exact: true }), folders = editor.getByRole('group', { name: 'Choose bookmark folder', exact: true }), folderSearch = folders.getByRole('textbox', { name: 'Search bookmark folders', exact: true })
  await expect(title).toBeFocused(); await expect(title).toHaveValue('Search fixture')
  await expect(editor.locator('form > p').first()).toHaveText(`${url}/fixture`)
  await expect(editor).not.toContainText('Profile: default')
  await expect(editor).not.toContainText('Selected folder:')
  await expect(editor).not.toContainText('Press / to search')
  await expect(folders.locator('button[data-bookmark-folder]')).toHaveText(['Profile root', 'Work', 'Work / Guides'])
  await expect(folders.getByRole('button', { name: 'Profile root', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await chrome.keyboard.press('/')
  await expect(folderSearch).toBeFocused(); await folderSearch.fill('guides'); await folderSearch.press('Enter')
  await expect(folders.getByRole('button', { name: 'Work / Guides', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await folders.getByRole('button', { name: 'New folder inside Work / Guides', exact: true }).click()
  let folderName = folders.getByRole('textbox', { name: 'New folder name', exact: true })
  await expect(folderName).toBeFocused(); await folderName.fill('Reading'); await folderName.press('Enter')
  await expect(folders.getByRole('button', { name: 'Work / Guides / Reading', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await title.fill('Saved fixture')
  await chrome.screenshot({ path: path.resolve('artifacts/bookmark-editor.png') })
  await editor.getByRole('button', { name: 'Save bookmark', exact: true }).click()
  await expect(editor).toHaveCount(0)
  let bookmarks = (await state()).model.profiles[0].bookmarks
  expect(flattenBookmarks(bookmarks).filter(bookmark => bookmark.url === `${url}/fixture`)).toEqual([expect.objectContaining({ title: 'Saved fixture' })])
  expect(bookmarks[0].children[0].children.at(-1)).toMatchObject({ title: 'Reading', children: [expect.objectContaining({ title: 'Saved fixture' })] })

  await activate(); await rpc('focus-page', { client: (await state()).clientId })
  await application.evaluate(({ webContents }) => {
    let contents = webContents.getFocusedWebContents()!
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'd', modifiers: ['meta'] })
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'd', modifiers: ['meta'] })
  })
  await expect(editor).toBeVisible(); await expect(editor.getByRole('button', { name: 'Work / Guides / Reading', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await title.fill('Updated fixture'); await editor.getByRole('button', { name: 'Profile root', exact: true }).click()
  await editor.getByRole('button', { name: 'Save bookmark', exact: true }).click()
  bookmarks = (await state()).model.profiles[0].bookmarks
  expect(flattenBookmarks(bookmarks).filter(bookmark => bookmark.url === `${url}/fixture`)).toEqual([expect.objectContaining({ title: 'Updated fixture' })])
  expect(bookmarks.at(-1)).toMatchObject({ title: 'Updated fixture', url: `${url}/fixture` })
})

test('bookmark folders and sessions use the same full-row selection style', async () => {
  await open('bookmark')
  let bookmark = chrome.getByRole('dialog', { name: 'Bookmark', exact: true })
  let folder = bookmark.locator('button[data-bookmark-folder][aria-pressed="true"]')
  let selectedStyle = await folder.evaluate(element => {
    let style = getComputedStyle(element)
    return { background: style.backgroundColor, shadow: style.boxShadow, weight: style.fontWeight }
  })
  expect(selectedStyle.background).not.toBe('rgba(0, 0, 0, 0)')
  expect(selectedStyle.shadow).toBe('none')
  await bookmark.getByRole('button', { name: 'Close', exact: true }).click()
  await open('sessions')
  let session = chrome.getByRole('dialog', { name: 'Sessions', exact: true }).locator('button[data-session-row][data-active="true"]')
  expect(await session.evaluate(element => {
    let style = getComputedStyle(element)
    return { background: style.backgroundColor, shadow: style.boxShadow, weight: style.fontWeight }
  })).toEqual(selectedStyle)
})

test('find reports counts, moves in both directions, and stays responsive during an agent wait', async () => {
  await page.evaluate(() => { (window as any).waitReady = false; (window as any).waitPolls = 0 })
  let pending = cli('wait', '-t', pane.id, '--expression', '(window.waitPolls++, window.waitReady)', '--timeout', '10000')
  let result = pending.then(value => ({ value }), error => ({ error }))
  try {
    await expect.poll(() => page.evaluate(() => (window as any).waitPolls)).toBeGreaterThan(0)
    await openFind()
    let input = chrome.getByRole('textbox', { name: 'Find in page', exact: true }), counts = chrome.getByRole('status', { name: 'Find results', exact: true })
    await input.fill('lantern'); await expect(counts).toHaveText('1 / 3', { timeout: 2000 })
    await input.press('Enter'); await expect(counts).toHaveText('2 / 3')
    await input.press('Shift+Enter'); await expect(counts).toHaveText('1 / 3')
    await chrome.getByRole('button', { name: 'Previous match', exact: true }).click(); await expect(counts).toHaveText('3 / 3')
    await chrome.getByRole('button', { name: 'Next match', exact: true }).click(); await expect(counts).toHaveText('1 / 3')
    await input.fill('zzzz'); await expect(counts).toHaveText('No matches')
    await input.fill('lantern'); await expect(counts).toHaveText('1 / 3')
    await chrome.screenshot({ path: path.resolve('artifacts/find-counts.png') })
    await input.press('Escape'); await expect(input).toHaveCount(0)
    await expect.poll(async () => (await state()).findResults[original]).toBeUndefined()
    await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${url}/fixture`)
  } finally { await page.evaluate(() => { (window as any).waitReady = true }); await result }
  expect(await result).toEqual({ value: { matched: true } })
})

test('find results stay scoped to each tab and refresh after navigation', async () => {
  let other = notesWindow.panes[0].id
  await rpc('find', { tab: other, text: 'lantern' })
  await expect.poll(async () => (await state()).findResults[other]?.matches).toBe(3)
  await openFind()
  let input = chrome.getByRole('textbox', { name: 'Find in page', exact: true }), counts = chrome.getByRole('status', { name: 'Find results', exact: true })
  await input.fill('fixture'); await expect(counts).toHaveText('1 / 1')
  expect((await state()).findResults[other].text).toBe('lantern')
  await rpc('navigate', { tab: original, url: `${url}/docs`, waitUntil: 'none' })
  await expect(page.locator('h1')).toHaveText('Documentation')
  await expect(counts).toHaveText('No matches')
  await input.press('Escape'); await expect(input).toHaveCount(0)
  await expect.poll(async () => (await state()).findResults[original]).toBeUndefined()
  expect((await state()).findResults[other].matches).toBe(3)
  await rpc('find', { tab: other, text: '' })
  await rpc('navigate', { tab: original, url: `${url}/fixture` })
})

test('CLI waits target panes, distinguish visibility, and reject invalid requests without changing selection', async () => {
  let target = pane.id, before = (await state()).model.clients
  let targetPage = application.context().pages().find(page => page.url() === `${url}/fixture`)!
  await targetPage.evaluate(() => { document.querySelector('#ready')!.setAttribute('hidden', '') })
  expect(await cli('wait', '-t', target, '--selector', '#ready')).toEqual({ matched: true })
  expect(await cli('wait', '-t', target, '--selector', '#ready', '--state', 'hidden')).toEqual({ matched: true })
  await targetPage.evaluate(() => { setTimeout(() => document.querySelector('#ready')!.removeAttribute('hidden'), 200) })
  expect(await cli('wait', '-t', target, '--selector', '#ready', '--state', 'visible')).toEqual({ matched: true })
  await targetPage.evaluate(() => { setTimeout(() => { (document.querySelector('#ready') as HTMLElement).style.visibility = 'hidden' }, 200) })
  expect(await cli('wait', '-t', target, '--selector', '#ready', '--state', 'hidden')).toEqual({ matched: true })
  await expect(cli('wait', '-t', target, '--selector', '#ready', '--state', 'detached', '--timeout', '100')).rejects.toThrow('Wait timed out')
  await targetPage.evaluate(() => { setTimeout(() => document.querySelector('#ready')!.remove(), 200) })
  expect(await cli('wait', '-t', target, '--selector', '#ready', '--state', 'detached')).toEqual({ matched: true })
  expect(await cli('wait', '-t', target, '--selector', '#ready', '--state', 'hidden')).toEqual({ matched: true })
  expect(await cli('wait', '-t', target, '--selector', '#offscreen', '--state', 'visible')).toEqual({ matched: true })
  expect(await cli('wait', '-t', target, '--selector', '[data-label="a\'b"]', '--state', 'visible')).toEqual({ matched: true })
  await expect(cli('wait', '-t', target, '--selector', '[')).rejects.toThrow('Invalid wait selector')
  await expect(cli('wait', '-t', target, '--selector', '#ready', '--state', 'invalid')).rejects.toThrow('Wait state')
  await expect(cli('wait', '-t', target, '--expression', 'missingIdentifier.value')).rejects.toThrow('Wait expression threw')
  await expect(cli('wait', '-t', target, '--selector', '#ready', '--timeout', 'invalid')).rejects.toThrow('timeout')
  expect((await state()).model.clients).toEqual(before)
})

test('session profile can be chosen at creation and changed while its only pane is blank', async () => {
  await open('sessions')
  await chrome.getByRole('group', { name: 'Choose session' }).getByRole('button', { name: 'new session', exact: true }).click()
  let form = chrome.getByRole('form', { name: 'New session' })
  await form.getByRole('combobox', { name: 'Session profile' }).selectOption('new')
  await form.getByRole('textbox', { name: 'Profile name' }).fill('Fresh identity')
  await form.getByRole('button', { name: 'Create session' }).click()
  let current = await state(), client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)!
  let created = current.model.sessions.find((item: { id: string }) => item.id === client.sessionId)!
  let fresh = current.model.profiles.find((item: { name: string }) => item.name === 'Fresh identity')!
  expect(created.defaultProfileId).toBe(fresh.id)
  expect(created.windows[0].panes[0].profileId).toBe(fresh.id)
  await chrome.getByRole('button', { name: 'Profile: Fresh identity' }).click()
  let panel = chrome.getByRole('dialog', { name: 'Profile' })
  await expect(panel.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByRole('tab', { name: 'Device' })).toBeVisible()
  await expect(panel.getByRole('tab', { name: 'Connection' })).toBeVisible()
  await expect(panel).not.toContainText('Sessions organize windows')
  await panel.getByRole('combobox', { name: 'Change session profile' }).selectOption(model.profiles[1].id)
  await expect.poll(async () => (await state()).model.sessions.find((item: { id: string }) => item.id === created.id)?.windows[0].panes[0].profileId).toBe(model.profiles[1].id)
  await panel.getByRole('button', { name: 'Close' }).click()
  let blank = created.windows[0].panes[0].id
  await rpc('navigate', { pane: blank, url: `${url}/profile-changed` })
  await expect.poll(() => application.context().pages().some(page => page.url() === `${url}/profile-changed`)).toBe(true)
  await expect(rpc('session.profile.set', { session: created.id, profile: fresh.id })).rejects.toThrow('Profile can only change')
  await chrome.getByRole('button', { name: `Profile: ${model.profiles[1].name}` }).click()
  await expect(chrome.getByRole('dialog', { name: 'Profile' }).getByRole('combobox', { name: 'Change session profile' })).toHaveCount(0)
})

test('renaming a fresh blank session restores a closed session profile unless a profile or page was chosen', async () => {
  let client = (await state()).clientId
  let old = await rpc('new-session', { name: 'restored identity', profile: model.profiles[1].id }) as { id: string }
  await rpc('kill-session', { session: old.id, confirm: true })
  expect((await state()).model.closedSessionProfiles?.['restored identity']).toBe(model.profiles[1].id)
  let direct = await rpc('new-session', { name: 'restored identity' }) as { id: string; defaultProfileId: string }
  expect(direct.defaultProfileId).toBe(model.profiles[1].id)
  await rpc('kill-session', { session: direct.id, confirm: true })
  let blank = await rpc('new-session', { client }) as { id: string }
  expect((await state()).model.sessions.find((item: { id: string }) => item.id === blank.id)?.profileExplicit).toBeUndefined()
  await rpc('rename-session', { session: blank.id, name: 'restored identity' })
  let restored = (await state()).model.sessions.find((item: { id: string }) => item.id === blank.id)!
  expect(restored.defaultProfileId).toBe(model.profiles[1].id)
  expect(restored.windows[0].panes[0].profileId).toBe(model.profiles[1].id)
  await rpc('kill-session', { session: blank.id, confirm: true })

  let explicit = await rpc('new-session', { client, profile: model.profiles[0].id }) as { id: string }
  await rpc('rename-session', { session: explicit.id, name: 'restored identity' })
  expect((await state()).model.sessions.find((item: { id: string }) => item.id === explicit.id)?.defaultProfileId).toBe(model.profiles[0].id)
  let visitedOld = await rpc('new-session', { name: 'visited identity', profile: model.profiles[1].id }) as { id: string }
  await rpc('kill-session', { session: visitedOld.id, confirm: true })
  let visited = await rpc('new-session', { client }) as { id: string; windows: { panes: { id: string }[] }[] }
  await rpc('navigate', { pane: visited.windows[0].panes[0].id, url: `${url}/visited-before-rename` })
  await rpc('rename-session', { session: visited.id, name: 'visited identity' })
  expect((await state()).model.sessions.find((item: { id: string }) => item.id === visited.id)?.defaultProfileId).toBe(model.profiles[0].id)
})
