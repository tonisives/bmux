import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { initialModel, newSession, newTab } from '../src/main/model'

let application: ElectronApplication, chrome: Page, page: Page, directory: string, url: string, server: http.Server
let model = initialModel(), session = model.sessions[0], pane = session.windows[0].panes[0], original = pane.activeTabId
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
  pane.tabs.push(newTab(`${url}/docs`), newTab(`${url}/notes`))
  model.profiles[0].bookmarks = [{ id: 'work', title: 'Work', children: [{ id: 'docs', title: 'Guides', children: [
    { id: 'api', title: 'API reference', url: `${url}/docs` }, { id: 'unsupported', title: 'Disabled bookmarklet', url: 'javascript:void(0)' },
  ] }, { id: 'notes', title: 'Research notes', url: `${url}/notes` },
  { id: 'sessions', title: 'Sessions', url: `${url}/sessions` },
  { id: 'suggestions', title: 'Search suggestions', url: `${url}/suggestions` },
  { id: 'url-only', title: 'Other page', url: `${url}/sessions/other` }] }]
  model.profiles[1].bookmarks = [{ id: 'bot-docs', title: 'Bot-only docs', url: `${url}/bot` }]
  model.profiles[0].history = [{ title: 'Research notes', url: `${url}/notes`, visitedAt: Date.parse('2026-01-02T03:04:00Z') }]
  model.profiles[1].history = [{ title: 'Bot-only visit', url: `${url}/bot`, visitedAt: Date.parse('2026-01-01T03:04:00Z') }]
  model.sessions.push(newSession('Project planning', model.profiles[1].id))
  for (let index = 0; index < 24; index++) model.sessions.push(newSession(`Scroll fixture ${index + 1}`, model.profiles[0].id))
  await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify(model))
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
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
  await rpc('tab.select', { tab: original }); await rpc('navigate', { tab: original, url: `${url}/fixture` }); await activate()
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

test('session picker creates and attaches a named session', async () => {
  await open('sessions')
  let sessions = chrome.getByRole('group', { name: 'Choose session', exact: true })
  let create = sessions.getByRole('button', { name: 'new session', exact: true })
  await expect(sessions.getByRole('button').last()).toHaveText('new session')
  await create.click()
  let name = sessions.getByRole('textbox', { name: 'Session name', exact: true })
  await expect(name).toBeFocused(); await name.fill('Fresh workspace')
  await sessions.getByRole('button', { name: 'Create session', exact: true }).click()
  await expect(sessions).toHaveCount(0)
  let current = await state(), client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)
  expect(current.model.sessions.find((item: { id: string; name: string }) => item.id === client?.sessionId)?.name).toBe('Fresh workspace')
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

test('session picker reaches creation by keyboard and confirms session closing', async () => {
  await open('sessions')
  let sessions = chrome.getByRole('group', { name: 'Choose session', exact: true })
  let create = sessions.getByRole('button', { name: 'new session', exact: true })
  await chrome.keyboard.press('End'); await expect(create).toBeFocused()
  await chrome.keyboard.press('Enter'); await expect(sessions.getByRole('textbox', { name: 'Session name', exact: true })).toBeFocused()
  await chrome.keyboard.press('Escape')
  let close = sessions.getByRole('button', { name: 'Close session Fresh workspace', exact: true })
  await close.click()
  let confirmation = sessions.getByRole('alertdialog', { name: 'Close session Fresh workspace?', exact: true })
  await expect(confirmation).toBeVisible(); await confirmation.getByRole('button', { name: 'no', exact: true }).click()
  await close.click(); await confirmation.getByRole('button', { name: 'yes', exact: true }).click()
  await expect.poll(async () => (await state()).model.sessions.some((session: { name: string }) => session.name === 'Fresh workspace')).toBe(false)
})

test('picker arrows expose panel content beyond the first and last rows', async () => {
  await open('sessions')
  let panel = chrome.getByRole('dialog', { name: 'Sessions', exact: true })
  let scroll = () => panel.evaluate(element => ({ top: element.scrollTop, bottom: element.scrollHeight - element.clientHeight }))
  await chrome.keyboard.press('End')
  await expect.poll(async () => (await scroll()).top).toBeLessThan((await scroll()).bottom)
  await chrome.keyboard.press('ArrowDown')
  await expect.poll(async () => { let position = await scroll(); return position.bottom - position.top }).toBeLessThan(2)
  await chrome.keyboard.press('Home')
  await expect.poll(async () => (await scroll()).top).toBeGreaterThan(0)
  await chrome.keyboard.press('ArrowUp')
  await expect.poll(async () => (await scroll()).top).toBe(0)
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
  let before = (await state()).model.sessions[0].windows[0].panes[0]
  await chrome.keyboard.press('Enter'); await expect(group).toHaveCount(0)
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${url}/docs`)
  let after = (await state()).model.sessions[0].windows[0].panes[0]
  expect(after.tabs).toHaveLength(before.tabs.length + 1)
  expect(after.activeTabId).not.toBe(before.activeTabId)
  expect((await state()).model.sessions[0].windows[0].panes[0].profileId).toBe('profile_default')

  await open('bookmarks')
  let newGroup = chrome.getByRole('group', { name: 'Choose bookmark', exact: true }), newSearch = newGroup.getByRole('textbox', { name: 'Search bookmarks', exact: true })
  await newSearch.fill('API reference')
  let beforeMetaEnter = (await state()).model.sessions[0].windows[0].panes[0]
  await newSearch.press('Meta+Enter')
  await expect(newGroup).toHaveCount(0)
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${url}/docs`)
  let afterMetaEnter = (await state()).model.sessions[0].windows[0].panes[0]
  expect(afterMetaEnter.tabs).toHaveLength(beforeMetaEnter.tabs.length + 1)
  expect(afterMetaEnter.activeTabId).not.toBe(beforeMetaEnter.activeTabId)
})

test('history search stays profile scoped and opens a result in the selected pane', async () => {
  await open('history')
  let group = chrome.getByRole('group', { name: 'Choose history entry', exact: true }), search = group.getByRole('textbox', { name: 'Search history', exact: true })
  await expect(search).toBeFocused(); await search.fill('research notes')
  await expect(group.getByRole('button')).toHaveCount(1)
  await search.fill('bot-only'); await expect(group.getByRole('status')).toHaveText('No matching history.')
  await search.press('Escape'); await expect(search).toHaveValue('')
  await search.fill('research notes'); await search.press('Enter')
  await expect(group).toHaveCount(0)
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${url}/notes`)
  await rpc('navigate', { tab: original, url: `${url}/fixture` })
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
  let pending = cli('wait', '-t', original, '--expression', '(window.waitPolls++, window.waitReady)', '--timeout', '10000')
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
  let other = pane.tabs[1].id
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

test('CLI waits distinguish attachment and visibility and reject invalid requests without changing selection', async () => {
  let target = pane.tabs[1].id, before = (await state()).model.clients
  let targetPage = application.context().pages().find(page => page.url() === `${url}/docs`)!
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
