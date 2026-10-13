import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { parse, stringify } from 'yaml'

let directory: string, application: ElectronApplication, chrome: Page, server: http.Server, base: string
let rpc = (method: string, args: Record<string, unknown> = {}): Promise<any> => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let state = (): Promise<any> => chrome.evaluate(() => (window as any).bmux.state())
let profile = '', bookmark = 'reddit', session = '', client = ''
let launch = async () => {
  application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_DEBUG: '1' } })
  await expect.poll(async () => {
    for (let candidate of application.context().pages()) if (candidate.url().endsWith('/renderer/index.html') && await candidate.getByRole('button', { name: 'Command prompt', exact: true }).count()) { chrome = candidate; return true }
    return false
  }).toBe(true)
  expect((await state()).configError).toBeNull()
  expect((await state()).plugins.find((plugin: any) => plugin.id === 'fixture.reddit')).toMatchObject({ enabled: true, bookmark: { script: './filter.js' } })
  let current = await state(); client = current.clientId; session = current.model.clients.find((item: any) => item.id === client).sessionId; profile = current.model.profiles[0].id
  await rpc('activate-client', { client })
}
let pageFor = async (pane: string): Promise<Page> => {
  let url = (await state()).model.sessions.flatMap((item: any) => item.windows).flatMap((item: any) => item.panes).find((item: any) => item.id === pane).url
  await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
  let pages = application.context().pages().filter(page => page.url() === url)
  let page = pages.at(-1)!
  await expect(page.locator('h1')).toHaveText('Search fixture')
  return page
}
let overlayEval = async (pane: string, expression: string) => {
  let frame = await rpc('cdp', { tab: pane, method: 'Page.getFrameTree' })
  let context = await rpc('cdp', { tab: pane, method: 'Page.createIsolatedWorld', params: { frameId: frame.frameTree.frame.id, worldName: 'bmux:bookmark-plugins' } })
  let result = await rpc('cdp', { tab: pane, method: 'Runtime.evaluate', params: { expression, contextId: context.executionContextId, returnByValue: true } })
  if (result.exceptionDetails) throw new Error('Overlay fixture evaluation failed')
  return result.result.value
}
let configure = (values: Record<string, unknown>, enabled = true) => rpc('bookmark.plugins.update', { profile, bookmark, id: 'fixture.reddit', enabled, values })
let openBookmark = async () => (await rpc('bookmark.open', { profile, bookmark, session, client })).panes[0].id as string
let modern = '<shreddit-post id="t3_low" post-title="Low" score="1" comment-count="1">Low</shreddit-post><shreddit-post id="t3_first" post-title="First" score="5" comment-count="5"><h2>First</h2></shreddit-post><shreddit-post id="t3_repeat" post-title=" FIRST " score="10" comment-count="10">Repeated title</shreddit-post><shreddit-post id="t3_unknown" post-title="Unknown" comment-count="1">Unknown score</shreddit-post>'
let old = '<div class="search-result-link" id="t3_low"><a class="search-title" href="/r/test/comments/low/title">Low</a><span class="search-score">1 point</span><a class="search-comments">1 comment</a></div><div class="search-result-link" id="t3_first"><a class="search-title" href="/r/test/comments/first/title">First</a><span class="search-score">5 points</span><a class="search-comments">5 comments</a></div><div class="search-result-link" id="t3_repeat"><a class="search-title" href="/r/test/comments/repeat/title"> FIRST </a><span class="search-score">10 points</span><a class="search-comments">10 comments</a></div>'
let searchCard = (key: string, id: string, title: string, score: number, comments: number) => `<search-telemetry-tracker data-testid="search-sdui-post"><div data-testid="search-post-unit" id="${key}"><search-telemetry-tracker><a data-testid="post-title" href="/r/test/comments/${id}/title" aria-label="${title}"></a></search-telemetry-tracker><div data-testid="sdui-post-unit"><h2><a data-testid="post-title-text" href="/r/test/comments/${id}/title">${title}</a></h2><div data-testid="search-counter-row"><span><faceplate-number number="${comments}">${comments}</faceplate-number> comments</span><span>·</span><span><faceplate-number number="${score}">${score >= 1000 ? '1.5k' : score}</faceplate-number> votes</span></div></div></div></search-telemetry-tracker>`
let sdui = searchCard('sdui_zero', 'zero', 'Zero score', 0, 1) + searchCard('sdui_low', 'low', 'A title mentioning 100 votes and 100 comments', 1, 1) + searchCard('sdui_comments', 'comments', 'Low comments', 5, 1) + searchCard('sdui_first', 'first', 'First card', 1500, 5) + searchCard('sdui_repeat', 'repeat', ' FIRST  CARD ', 5, 5) + searchCard('sdui_same_post', 'first', 'Another title', 5, 5)
test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-bookmark-plugin-gui-'))
  let folder = path.join(directory, 'plugins/fixture.reddit'); await fs.mkdir(folder, { recursive: true })
  let manifest = parse(await fs.readFile('bundled-plugins/bmux.reddit-search/plugin.yaml', 'utf8'))
  manifest.id = 'fixture.reddit'; manifest.bookmark.matches = ['http://127.0.0.1:*/search*', 'http://127.0.0.1:*/r/*/search*']
  await fs.writeFile(path.join(folder, 'plugin.yaml'), stringify(manifest)); await fs.copyFile('bundled-plugins/bmux.reddit-search/filter.js', path.join(folder, 'filter.js'))
  await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: {}, browser: { autoUpdateFilters: false }, memory: { lazyRestore: false }, plugins: { 'fixture.reddit': { enabled: true, hooks: false } } }))
  server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
    response.end(`<!doctype html><title>Search fixture</title><style>shreddit-post,.search-result-link,[data-testid="search-post-unit"]{display:block;padding:15px;margin:8px;border:1px solid gray}body{min-height:1800px}</style><h1>Search fixture</h1>${request.url?.includes('sdui') ? sdui : request.url?.includes('old') ? old : modern}`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${(server.address() as any).port}`
  await launch()
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0].id
  await rpc('navigate', { tab: pane, url: `${base}/search?initial=1` })
  let saved = await rpc('bookmark.add', { tab: pane, title: 'Reddit search fixture' }); bookmark = saved.bookmark.id
  await rpc('bookmark.update', { profile, bookmark, url: `${base}/search` })
})
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) { let current = await state(); await info.attach('bookmark-plugin-state', { body: JSON.stringify({ plugins: current.plugins, attachments: current.bookmarkPlugins, errors: current.bookmarkPluginErrors, windows: current.model.sessions[0].windows }), contentType: 'application/json' }) } })
test.afterAll(async () => {
  if (application) await closeTestApplication(application)
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
test('bookmark plugins remain pane-scoped and the overlay toggles and configures them', async () => {
  expect(await configure({})).toMatchObject([{ id: 'fixture.reddit', enabled: true, values: { minScore: 2 } }])
  let pane = await openBookmark(), page = await pageFor(pane)
  expect((await state()).bookmarkPluginErrors[pane]).toBeUndefined()
  await expect(page.locator('[data-bmux-bookmark-plugins]')).toBeVisible()
  await expect(page.locator('#t3_low')).toBeHidden(); await expect(page.locator('#t3_repeat')).toBeHidden(); await expect(page.locator('#t3_unknown')).toBeVisible()
  await expect(page.locator('[data-bmux-bookmark-plugins]')).toBeVisible()
  expect(await page.evaluate(() => ({ node: typeof (window as any).require, binding: typeof (window as any).__bmuxBookmarkSettings }))).toEqual({ node: 'undefined', binding: 'undefined' })
  let ordinary = await rpc('new-window', { session, client, profile, url: `${base}/search?ordinary=1` }), ordinaryPage = await pageFor(ordinary.panes[0].id)
  await expect(ordinaryPage.locator('#t3_low')).toBeVisible(); await expect(ordinaryPage.locator('[data-bmux-bookmark-plugins]')).toHaveCount(0)
  await rpc('select-window', { window: (await state()).model.sessions.flatMap((item: any) => item.windows).find((item: any) => item.panes.some((item: any) => item.id === pane)).id, client })
  let point = await overlayEval(pane, `(() => { let input = globalThis.__bmuxBookmarkOverlay.querySelector('input[type="checkbox"]'), rect = input.getBoundingClientRect(); return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 } })()`)
  await page.mouse.click(point.x, point.y)
  await expect.poll(async () => (await state()).bookmarkPlugins[profile][bookmark][0].enabled).toBe(false)
  await expect(page.locator('#t3_low')).toBeVisible(); await expect(page.locator('#t3_repeat')).toBeVisible()
  await overlayEval(pane, `(() => { let input = globalThis.__bmuxBookmarkOverlay.querySelector('input[type="checkbox"]'); input.click(); return true })()`)
  await expect(page.locator('#t3_low')).toBeHidden()
  await overlayEval(pane, `(() => { let input = globalThis.__bmuxBookmarkOverlay.querySelector('[aria-label="Minimum score"]'); input.value = '6'; input.dispatchEvent(new Event('change')); return true })()`)
  await expect.poll(async () => (await state()).bookmarkPlugins[profile][bookmark][0].values.minScore).toBe(6)
  await expect(page.locator('#t3_first')).toBeHidden(); await expect(page.locator('#t3_repeat')).toBeVisible()
  await configure({})
  await rpc('reload', { tab: pane }); await expect(page.locator('#t3_low')).toBeHidden()
  await page.evaluate(() => { let node = document.createElement('shreddit-post'); node.id = 't3_new'; node.setAttribute('post-title', 'first'); node.setAttribute('score', '5'); node.setAttribute('comment-count', '5'); document.body.append(node) })
  await expect(page.locator('#t3_new')).toBeHidden()
  await page.evaluate(() => history.pushState({}, '', '/r/test/comments/example/discussion'))
  await expect(page.locator('#t3_low')).toBeVisible(); await expect(page.locator('[data-bmux-bookmark-plugins]')).toHaveCount(0)
  await page.evaluate(() => history.pushState({}, '', '/search?q=new'))
  await expect(page.locator('#t3_low')).toBeHidden(); await expect(page.locator('[data-bmux-bookmark-plugins]')).toBeVisible()
  let child = await rpc('new-window', { session, profile, url: `${base}/search?child=1` })
  expect(child.panes[0].bookmarkSource).toBeUndefined()
  await fs.mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/bookmark-plugin-overlay.png' })
})
test('bookmark plugins expose settings without URL parameters and support old Reddit markup', async () => {
  await configure({})
  let current = await state(); await rpc('activate-client', { client }); await rpc('select-window', { window: current.model.sessions[0].windows[0].id, client })
  await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click()
  await chrome.getByRole('combobox', { name: 'Command', exact: true }).fill('bookmarks'); await chrome.getByRole('combobox', { name: 'Command', exact: true }).press('Enter')
  await chrome.getByRole('button', { name: 'Customize Reddit search fixture', exact: true }).click()
  await expect(chrome.getByRole('combobox', { name: 'Add bookmark plugin' })).toBeVisible()
  await expect(chrome.getByRole('spinbutton', { name: 'Minimum score', exact: true })).toHaveValue('2')
  let minimum = chrome.getByRole('spinbutton', { name: 'Minimum score', exact: true })
  await minimum.fill('4')
  await rpc('bookmark.update', { profile, bookmark, title: 'Reddit search fixture edited' })
  await expect(chrome.getByRole('button', { name: 'Reddit search fixture edited', exact: true })).toBeVisible()
  await expect(minimum).toHaveValue('4')
  await rpc('bookmark.update', { profile, bookmark, title: 'Reddit search fixture' })
  await minimum.press('Tab')
  await expect.poll(async () => (await state()).bookmarkPlugins[profile][bookmark][0].values.minScore).toBe(4)
  await chrome.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(chrome.getByRole('textbox', { name: 'Search bookmarks' })).toHaveCount(0)
  current = await state(); let pane = current.model.clients.find((item: any) => item.id === client).paneId
  await rpc('navigate', { tab: pane, url: `${base}/search?old=1` }); let page = await pageFor(pane)
  await expect(page.locator('#t3_low')).toBeHidden(); await expect(page.locator('#t3_repeat')).toBeHidden(); await expect(page.locator('#t3_first')).toBeVisible()
  await rpc('plugin.enable', { id: 'fixture.reddit', enabled: false })
  await expect(page.locator('#t3_low')).toBeVisible()
  await rpc('plugin.enable', { id: 'fixture.reddit', enabled: true }); await expect(page.locator('#t3_low')).toBeHidden()
  await closeTestApplication(application); await launch()
  await expect.poll(async () => (await state()).model.sessions.flatMap((item: any) => item.windows).flatMap((item: any) => item.panes).find((item: any) => item.id === pane)?.bookmarkSource?.bookmarkId).toBe(bookmark)
  page = await pageFor(pane); await expect(page.locator('#t3_low')).toBeHidden()
  await rpc('bookmark.plugins.update', { profile, bookmark, id: 'fixture.reddit', remove: true })
  await expect(page.locator('#t3_low')).toBeVisible(); await expect(page.locator('[data-bmux-bookmark-plugins]')).toHaveCount(0)
})
test('address bookmark suggestions attach plugins while preserving the selected pane', async () => {
  await configure({})
  let current = await state(), original = current.model.sessions[0].windows[0], pane = original.panes[0].id
  let count = current.model.sessions[0].windows.length, page = await pageFor(pane)
  await rpc('activate-client', { client }); await rpc('select-window', { window: original.id, client })
  await chrome.locator(`[data-pane-id="${pane}"]`).getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.fill('Reddit search fixture'); await address.press('ArrowDown'); await address.press('Enter')
  await expect(address).toHaveCount(0)
  await expect(page).toHaveURL(`${base}/search`)
  await expect(page.locator('#t3_low')).toBeHidden(); await expect(page.locator('[data-bmux-bookmark-plugins]')).toBeVisible()
  current = await state()
  expect(current.model.sessions[0].windows).toHaveLength(count)
  expect(current.model.clients.find((item: any) => item.id === client).paneId).toBe(pane)
  expect(current.model.sessions[0].windows[0].panes[0].bookmarkSource).toEqual({ profileId: profile, bookmarkId: bookmark })
})
test('Reddit search unit cards filter numeric counters, duplicates and loaded updates', async () => {
  await configure({})
  let pane = await openBookmark(), page = await pageFor(pane)
  await rpc('navigate', { tab: pane, url: `${base}/search?sdui=1` })
  for (let id of ['sdui_zero', 'sdui_low', 'sdui_comments', 'sdui_repeat', 'sdui_same_post']) await expect(page.locator(`#${id}`)).toBeHidden()
  await expect(page.locator('#sdui_first')).toBeVisible()
  await configure({ minScore: 1501 })
  await expect(page.locator('#sdui_first')).toBeHidden()
  await configure({})
  await page.locator('#sdui_zero').evaluate(node => {
    let numbers = node.querySelectorAll('faceplate-number')
    numbers[0].setAttribute('number', '5'); numbers[1].setAttribute('number', '5')
  })
  await expect(page.locator('#sdui_zero')).toBeVisible()
  await page.evaluate(html => document.body.insertAdjacentHTML('beforeend', html), searchCard('sdui_appended', 'appended', 'first card', 5, 5))
  await expect(page.locator('#sdui_appended')).toBeHidden()
  await configure({}, false)
  for (let id of ['sdui_low', 'sdui_comments', 'sdui_repeat', 'sdui_same_post', 'sdui_appended']) await expect(page.locator(`#${id}`)).toBeVisible()
  await configure({})
  await expect(page.locator('#sdui_low')).toBeHidden()
})
