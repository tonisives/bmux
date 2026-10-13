import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { initialModel } from '../src/main/model'
import { closeTestApplication } from './electron-fixture'

test('bookmark viewing position survives app restarts with folders, search, and profile scope', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-bookmark-view-'))
  let application: ElectronApplication | undefined, chrome!: Page, group!: Locator, search!: Locator, list!: Locator
  let model = initialModel(), profile = model.profiles[0], other = model.profiles[1]
  let fixture = path.join(directory, 'fixture.html'), url = pathToFileURL(fixture).href
  let launch = async () => {
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  }
  let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
  let open = async () => {
    let client = await chrome.evaluate(async () => (await (window as any).bmux.state()).clientId)
    await rpc('activate-client', { client })
    await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click()
    let input = chrome.getByRole('combobox', { name: 'Command', exact: true })
    await input.fill('bookmarks'); await input.press('Enter')
    group = chrome.getByRole('group', { name: 'Choose bookmark', exact: true })
    search = group.getByRole('textbox', { name: 'Search bookmarks', exact: true })
    list = group.locator('[data-bookmark-scroll]')
  }
  try {
    await fs.writeFile(fixture, '<!doctype html><title>Bookmark fixture</title><h1>Bookmark fixture</h1>')
    await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  autoUpdateFilters: false\n')
    profile.bookmarks = [{ id: 'folder', title: 'Collapsed folder', children: [{ id: 'hidden', title: 'Hidden child', url }] }, ...Array.from({ length: 60 }, (_, index) => ({ id: `row-${index}`, title: `Reading ${index}`, url }))]
    other.bookmarks = [{ id: 'other', title: 'Other profile', url }]
    model.sessions[0].windows[0].panes[0].url = url
    await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify(model))
    await launch(); await open()
    await group.getByRole('checkbox', { name: 'All profiles' }).check()
    await group.locator('[data-bookmark-folder-title]').filter({ hasText: /^Collapsed folder$/ }).click()
    await expect(group.getByRole('button', { name: 'Hidden child', exact: true })).toBeHidden()
    await group.getByRole('button', { name: 'Reading 10', exact: true }).focus()
    await list.evaluate(element => { element.scrollTop = 160 })
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(160)
    await expect.poll(() => chrome.evaluate(id => JSON.parse(localStorage.getItem('bookmark-view')!).views[id]?.scroll, profile.id)).toBe(160)
    await closeTestApplication(application!); application = undefined
    await launch(); await open()
    await expect(search).toHaveValue('')
    await expect(group.getByRole('checkbox', { name: 'All profiles' })).toBeChecked()
    await expect(group.getByRole('button', { name: 'Hidden child', exact: true })).toBeHidden()
    await expect(group.getByRole('button', { name: 'Reading 10', exact: true })).toBeFocused()
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(160)
    await search.fill('Hidden child')
    await expect(group.getByRole('button', { name: 'Hidden child', exact: true })).toBeVisible()
    await search.fill('')
    await expect(group.getByRole('button', { name: 'Hidden child', exact: true })).toBeHidden()
    await search.fill('Reading 2')
    await group.getByRole('button', { name: 'Reading 22', exact: true }).focus()
    await expect.poll(() => chrome.evaluate(id => JSON.parse(localStorage.getItem('bookmark-view')!).selections[id], profile.id)).toBe(JSON.stringify([profile.id, 'row-22']))
    await closeTestApplication(application!); application = undefined
    await launch(); await open()
    await expect(search).toHaveValue('Reading 2')
    await expect(group.getByRole('button', { name: 'Reading 22', exact: true })).toBeFocused()
    let client = await chrome.evaluate(async () => (await (window as any).bmux.state()).clientId)
    await rpc('new-window', { session: model.sessions[0].id, client, profile: other.id })
    await open(); await expect(search).toHaveValue('')
    await expect(group.getByRole('button', { name: 'Other profile', exact: true })).toBeVisible()
  } finally {
    if (application) await closeTestApplication(application)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
