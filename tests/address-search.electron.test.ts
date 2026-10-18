import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { initialModel } from '../src/main/model'
import { closeTestApplication } from './electron-fixture'

test('address search selects search for phrases and domains for exact known names while retaining search below', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-address-search-'))
  let model = initialModel()
  model.profiles[0].history = [{ url: 'https://github.com/acme/issues', title: 'GitHub issues', visitedAt: 1 }]
  await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify(model))
  await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  autoUpdateFilters: false\n')
  let application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  try {
    await application.context().route('https://www.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Search fixture</title><h1>Search fixture</h1>' }))
    await application.context().route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>GitHub fixture</title><h1>GitHub fixture</h1>' }))
    await application.context().route('https://maps.google.com/**', route => route.fulfill({ status: 302, headers: { location: 'https://www.google.com/maps' } }))
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = () => chrome.evaluate(() => (window as any).bmux.state())
    await rpc('activate-client', { client: (await state()).clientId })
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    let options = chrome.getByRole('listbox', { name: 'Address suggestions' }).getByRole('option')
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    await address.fill('github issues')
    await expect(address).toHaveValue('github issues')
    await expect(options.first()).toHaveAttribute('data-kind', 'search')
    await expect(options.first()).toHaveAttribute('aria-selected', 'true')
    await expect(options.filter({ hasText: 'https://github.com/acme/issues' })).toHaveCount(1)
    await address.press('Enter')
    let searchUrl = 'https://www.google.com/search?q=github%20issues'
    await expect.poll(() => application.context().pages().some(page => page.url() === searchUrl)).toBe(true)
    await expect(application.context().pages().find(page => page.url() === searchUrl)!.locator('h1')).toHaveText('Search fixture')

    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    await address.fill('git')
    await expect(address).toHaveValue('git')
    await expect(options.first()).toHaveAttribute('data-kind', 'search')
    await address.fill('github')
    await expect(address).toHaveValue('github.com')
    await expect(options.first()).toHaveAttribute('data-value', 'https://github.com/')
    await expect(options.first()).toHaveAttribute('aria-selected', 'true')
    let search = options.filter({ hasText: 'Search Google for github' })
    await expect(search).toHaveCount(1)
    expect(await search.evaluate(element => Array.from(element.closest('[role="listbox"]')!.querySelectorAll('[role="option"]')).indexOf(element))).toBeLessThanOrEqual(3)
    await address.press('Enter')
    await expect.poll(() => application.context().pages().some(page => page.url() === 'https://github.com/')).toBe(true)
    await expect(application.context().pages().find(page => page.url() === 'https://github.com/')!.locator('h1')).toHaveText('GitHub fixture')

    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    await address.fill('maps.google.com')
    await expect(options.first()).toHaveAttribute('data-value', 'https://maps.google.com/')
    await address.press('Enter')
    await expect.poll(async () => (await state()).model.profiles[0].history.map((entry: { url: string }) => entry.url)).toEqual(expect.arrayContaining(['https://maps.google.com/', 'https://www.google.com/maps']))
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    await address.fill('maps')
    await expect(address).toHaveValue('maps.google.com')
    await expect(options.first()).toHaveAttribute('data-value', 'https://maps.google.com/')
    await address.press('ArrowRight')
    await options.filter({ hasText: 'Search Google for maps.google.com' }).click()
    await expect.poll(() => application.context().pages().some(page => page.url() === 'https://www.google.com/search?q=maps.google.com')).toBe(true)
  } finally {
    await closeTestApplication(application)
    await fs.rm(directory, { recursive: true, force: true })
  }
})
