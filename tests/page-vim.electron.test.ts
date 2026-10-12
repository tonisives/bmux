import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { closeTestApplication } from './electron-fixture'

let application: ElectronApplication, page: Page, directory: string, server: http.Server, config: string
let fixture = `<!doctype html><title>Vim field fixture</title>
<link rel="stylesheet" href="/fixture.css">
<form><input id="text" value="alpha bravo"><textarea id="notes">alpha bravo\ncharlie delta</textarea><input id="password" type="password"><input id="readonly" readonly value="locked"><input id="number" type="number"></form>
<div id="rich" contenteditable="true"><p>alpha bravo</p><p>charlie delta</p></div>
<div id="react"></div><div id="shadow"></div><button id="outside">Outside</button>
<script src="/fixture.js"></script>`

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-page-vim-'))
  config = path.join(directory, 'config.yaml')
  await fs.writeFile(config, 'accessibility: true\nkeyboard: {}\nbrowser:\n  adblock: false\n  autoUpdateFilters: false\n')
  let bundle = await build({ stdin: { contents: `
    import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
    let Form = () => { let [value, setValue] = useState('controlled'); return React.createElement(React.Fragment, null, React.createElement('input', { id: 'controlled', value, onChange: e => setValue(e.target.value) }), React.createElement('output', { id: 'controlled-value' }, value)); };
    createRoot(document.querySelector('#react')).render(React.createElement(Form));
    document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML = '<textarea id="shadow-text">shadow draft</textarea>';
    window.fixtureEvents = { input: 0, change: 0, submit: 0, keys: 0 };
    document.addEventListener('input', () => window.fixtureEvents.input++);
    document.addEventListener('change', () => window.fixtureEvents.change++);
    document.addEventListener('keydown', () => window.fixtureEvents.keys++);
    document.querySelector('form').addEventListener('submit', e => { e.preventDefault(); window.fixtureEvents.submit++; });
  `, resolveDir: process.cwd(), sourcefile: 'page-vim-fixture.js' }, bundle: true, write: false, platform: 'browser', format: 'iife' })
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': request.url === '/fixture.js' ? 'text/javascript' : request.url === '/fixture.css' ? 'text/css' : 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self' http://localhost:*" })
    response.end(request.url === '/fixture.js' ? bundle.outputFiles[0].text : request.url === '/fixture.css' ? 'body { padding: 30px; font: 16px sans-serif; } textarea, input, [contenteditable] { display: block; width: 450px; margin: 10px; } [contenteditable] { min-height: 60px; border: 1px solid #888; }' : fixture)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/fields`
  application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: config, BMUX_BACKGROUND: '0' } })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  expect(await chrome.evaluate(async () => (window as any).bmux.state().then((state: any) => state.configError))).toBeNull()
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.pressSequentially(url); await address.press('Enter')
  await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
  page = application.context().pages().find(page => page.url() === url)!
  await expect(page.locator('#controlled')).toHaveValue('controlled')
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(url)
})

test.afterAll(async () => {
  try { await closeTestApplication(application) }
  finally { server?.close(); if (directory) await fs.rm(directory, { recursive: true, force: true }) }
})

let open = async (field: Locator, owner = page) => {
  await field.click(); await field.press('Control+e')
  let overlay = owner.locator('[data-bmux-vim]')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveAttribute('data-mode', 'NORMAL')
  let editor = overlay.getByRole('textbox', { name: 'Vim text' })
  await expect(editor).toBeFocused()
  return { overlay, editor }
}
let ex = async (editor: Locator, command: string) => {
  await editor.pressSequentially(`:${command}`)
  // The command line lives in the editor's shadow root.
  let prompt = page.locator('[data-bmux-vim] .cm-vim-panel input')
  await expect(prompt).toBeFocused(); await prompt.press('Enter')
}

test('website Vim editor saves multiline motions, undo, and insert edits without submitting', async ({}, info) => {
  let field = page.locator('#notes'), { overlay, editor } = await open(field)
  await editor.pressSequentially('gg0dw')
  await expect(editor).toContainText('bravo')
  await editor.press('u'); await expect(editor).toContainText('alpha bravo')
  await editor.pressSequentially('j0cw'); await editor.pressSequentially('changed')
  await expect(overlay).toHaveAttribute('data-mode', 'INSERT')
  await editor.press('Escape'); await expect(overlay).toHaveAttribute('data-mode', 'NORMAL')
  await expect(field).toHaveValue('alpha bravo\ncharlie delta')
  await overlay.screenshot({ path: info.outputPath('vim-editor.png') })
  let keys = await page.evaluate(() => (window as any).fixtureEvents.keys)
  await ex(editor, 'wq')
  await expect(overlay).toHaveCount(0); await expect(field).toBeFocused()
  await expect(field).toHaveValue('alpha bravo\nchanged delta')
  expect(await page.evaluate(() => (window as any).fixtureEvents.submit)).toBe(0)
  expect(await page.evaluate(() => (window as any).fixtureEvents.keys)).toBe(keys)
})

test('website Vim editor discards drafts, writes controlled React inputs, and exits with Escape', async () => {
  let field = page.locator('#controlled'), { overlay, editor } = await open(field)
  await editor.pressSequentially('gg0cc'); await editor.pressSequentially('discarded'); await editor.press('Escape')
  await ex(editor, 'q')
  await expect(overlay).toHaveCount(0); await expect(field).toHaveValue('controlled')
  ;({ overlay, editor } = await open(field))
  await editor.pressSequentially('gg0cc'); await editor.pressSequentially('saved'); await editor.press('Escape')
  await ex(editor, 'w')
  await expect(field).toHaveValue('saved'); await expect(page.locator('#controlled-value')).toHaveText('saved')
  await expect(overlay).toBeVisible()
  await editor.pressSequentially('A!'); await editor.press('Escape'); await editor.press('Escape')
  await expect(overlay).toHaveCount(0); await expect(field).toHaveValue('saved!')
  await expect(page.locator('#controlled-value')).toHaveText('saved!'); await expect(field).toBeFocused()
})

test('website Vim editor updates rich text and shadow fields through native events', async () => {
  let rich = page.locator('#rich'), { overlay, editor } = await open(rich)
  await editor.pressSequentially('ggVGc'); await editor.pressSequentially('new  first'); await editor.press('Enter'); await editor.pressSequentially('new second'); await editor.press('Escape')
  await ex(editor, 'wq')
  expect((await rich.innerText()).replace(/\u00a0/g, ' ')).toBe('new  first\nnew second')
  await expect(overlay).toHaveCount(0)
  let shadow = page.locator('#shadow-text')
  ;({ overlay, editor } = await open(shadow))
  await editor.pressSequentially('gg0cw'); await editor.pressSequentially('edited'); await editor.press('Escape')
  await overlay.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(shadow).toHaveValue('edited draft'); await expect(shadow).toBeFocused()
  expect(await page.evaluate(() => (window as any).fixtureEvents.input)).toBeGreaterThan(0)
})

test('website Vim editor preserves conflicting drafts and handles removed, disabled, and password fields', async () => {
  let field = page.locator('#text'), { overlay, editor } = await open(field)
  await editor.pressSequentially('A draft'); await editor.press('Escape')
  await field.evaluate(element => { (element as HTMLInputElement).value = 'page update' })
  await ex(editor, 'wq')
  await expect(overlay).toContainText('Field changed on the page')
  await expect(editor).toContainText('draft'); await expect(field).toHaveValue('page update')
  await overlay.getByRole('button', { name: 'Discard' }).click()
  await expect(overlay).toHaveCount(0)
  for (let id of ['password', 'readonly', 'number']) {
    let input = page.locator(`#${id}`)
    await input.click(); await input.press('Control+e')
    await expect(page.locator('[data-bmux-vim]')).toHaveCount(0)
  }
  ;({ overlay, editor } = await open(field))
  await editor.pressSequentially('A retained draft'); await editor.press('Escape')
  await field.evaluate(element => element.remove())
  await expect(overlay).toContainText('Field no longer available')
  await expect(editor).toContainText('retained draft')
  await overlay.getByRole('button', { name: 'Discard' }).click()
  await expect(overlay).toHaveCount(0)
})

test('website Vim editor works in same-origin and cross-origin frames and honors live settings', async () => {
  await page.evaluate(() => {
    for (let cross of [false, true]) {
      let frame = document.createElement('iframe'); frame.id = cross ? 'cross' : 'same'; frame.width = '600'; frame.height = '320'
      frame.src = cross ? location.href.replace('127.0.0.1', 'localhost') : location.href
      document.body.append(frame)
    }
  })
  for (let id of ['same', 'cross']) {
    let frame = page.frameLocator(`#${id}`), field = frame.locator('#text')
    await page.locator(`#${id}`).scrollIntoViewIfNeeded()
    await field.click()
    // Subframes receive the isolated editor after their renderer has attached.
    await expect.poll(async () => {
      await field.press('Control+e')
      return frame.locator('[data-bmux-vim]').count()
    }).toBe(1)
    let overlay = frame.locator('[data-bmux-vim]'), editor = overlay.getByRole('textbox', { name: 'Vim text' })
    await editor.pressSequentially('gg0cw'); await editor.pressSequentially('frame'); await editor.press('Escape')
    await editor.pressSequentially(':wq')
    await frame.locator('[data-bmux-vim] .cm-vim-panel input').press('Enter')
    await expect(field).toHaveValue('frame bravo'); await expect(field).toBeFocused()
  }
  await fs.writeFile(config, 'vimEditing: false\naccessibility: true\nkeyboard: {}\nbrowser:\n  adblock: false\n  autoUpdateFilters: false\n')
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await expect.poll(() => chrome.evaluate(async () => (window as any).bmux.state().then((state: any) => state.vimEditing))).toBe(false)
  // Explicitly await page-tools refresh instead of racing its configuration queue.
  await chrome.evaluate(async () => (window as any).bmux.command({ method: 'browser.reload-scripts', args: {} }))
  let field = page.locator('#notes')
  await field.click(); await field.press('Control+e')
  await expect(page.locator('[data-bmux-vim]')).toHaveCount(0)
})
