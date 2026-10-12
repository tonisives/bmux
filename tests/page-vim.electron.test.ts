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
<script nonce="bmux-fixture" src="/fixture.js"></script>`

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-page-vim-'))
  config = path.join(directory, 'config.yaml')
  await fs.writeFile(config, 'accessibility: true\nkeyboard:\n  shortcuts:\n    Ctrl+E: null\n    Cmd+E: vim-editor\nbrowser:\n  adblock: false\n  autoUpdateFilters: false\n')
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
    response.writeHead(200, { 'Content-Type': request.url === '/fixture.js' ? 'text/javascript' : request.url === '/fixture.css' ? 'text/css' : 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'nonce-bmux-fixture'; frame-src 'self' http://localhost:*" })
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
  await field.click(); await field.press('Meta+e')
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

test('website Vim hints open by mouse and native click mode with the configured shortcut', async ({}, info) => {
  let hint = page.locator('[data-bmux-vim-hints] button[aria-controls="notes"]')
  await expect(hint).toBeVisible(); await expect(hint).toHaveAttribute('title', 'Edit with Vim (Cmd+E)')
  await expect(hint).toHaveText('v'); await expect(hint).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)'); await expect(hint).toHaveCSS('border-top-width', '0px')
  for (let id of ['password', 'readonly', 'number']) await expect(page.locator(`[data-bmux-vim-hints] button[aria-controls="${id}"]`)).toHaveCount(0)
  await hint.click()
  let overlay = page.locator('[data-bmux-vim]'), editor = overlay.getByRole('textbox', { name: 'Vim text' })
  await expect(editor).toBeFocused(); await editor.press('Escape'); await expect(overlay).toHaveCount(0)
  await expect(hint).toBeVisible()
  await page.screenshot({ path: info.outputPath('vim-hints.png') })
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await chrome.evaluate(async () => (window as any).bmux.command({ method: 'click-mode', args: {} }))
  await expect(page.locator('[data-bmux-click-mode]')).toHaveCount(1)
  let label = await application.evaluate(async ({ webContents }, url) => {
    let contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
    let { frameTree } = await contents.debugger.sendCommand('Page.getFrameTree')
    let { executionContextId } = await contents.debugger.sendCommand('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'bmux:click-mode' })
    let { result } = await contents.debugger.sendCommand('Runtime.evaluate', { contextId: executionContextId, expression: `(() => { let mode = globalThis.__bmuxClickMode; let index = mode.elements.findIndex(element => element.getAttribute('aria-controls') === 'notes'); return mode.shadow.querySelectorAll('span')[index]?.textContent })()`, returnByValue: true })
    return result.value as string
  }, page.url())
  expect(label).toMatch(/^[A-Z0-9]+$/)
  await application.evaluate(({ webContents }, label) => {
    let contents = webContents.getFocusedWebContents()!
    for (let key of label) {
      contents.sendInputEvent({ type: 'keyDown', keyCode: key.toLowerCase() })
      contents.sendInputEvent({ type: 'keyUp', keyCode: key.toLowerCase() })
    }
  }, label)
  await expect(editor).toBeFocused(); await expect(page.locator('[data-bmux-click-mode]')).toHaveCount(0)
  await editor.press('Escape')
  let field = page.locator('#notes')
  await field.click(); await field.press('Control+e'); await expect(overlay).toHaveCount(0)
  await application.evaluate(({ webContents }) => {
    let contents = webContents.getFocusedWebContents()!
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'e', modifiers: ['meta'] })
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'e', modifiers: ['meta'] })
  })
  await expect(editor).toBeFocused(); await editor.press('Escape')
})

test('website Vim hints keep readable contrast with Dark Reader and after navigation', async ({}, info) => {
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  let hint = page.locator('[data-bmux-vim-hints] button[aria-controls="notes"]')
  let contrast = () => hint.evaluate(element => {
    let style = getComputedStyle(element)
    let luminance = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => {
      let value = channel / 255
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
    }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0)
    let field = document.getElementById(element.getAttribute('aria-controls')!)!
    let backgroundColor = getComputedStyle(field).backgroundColor
    let backgroundChannels = backgroundColor.match(/[\d.]+/g)!.slice(0, 3).map(Number)
    let foregroundChannels = style.color.match(/[\d.]+/g)!.slice(0, 3).map(Number)
    let opacity = Number(style.opacity)
    let foregroundColor = `rgb(${foregroundChannels.map((channel, index) => channel * opacity + backgroundChannels[index] * (1 - opacity)).join(',')})`
    let foreground = luminance(foregroundColor), background = luminance(backgroundColor)
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)
  })
  let dark = (value: string) => chrome.evaluate(async value => {
    let state = await (window as any).bmux.state()
    let tab = state.model.clients.find((client: { id: string }) => client.id === state.clientId).paneId
    return (window as any).bmux.command({ method: 'browser.set', args: { tab, setting: 'darkMode', value } })
  }, value)
  let readerReady = () => expect.poll(() => page.locator('html').evaluate(element => getComputedStyle(element).colorScheme)).toBe('dark')
  await expect(hint).toBeVisible(); await expect.poll(contrast).toBeGreaterThan(4.5)
  await page.locator('#outside').hover(); await expect(hint).toHaveCSS('opacity', '0.8')
  await hint.hover(); await expect(hint).toHaveCSS('opacity', '1')
  await page.locator('#outside').hover(); await expect(hint).toHaveCSS('opacity', '0.8')
  await hint.focus(); await expect(hint).toHaveCSS('opacity', '1')
  await page.locator('#outside').focus(); await expect(hint).toHaveCSS('opacity', '0.8')
  try {
    await dark('dark'); await readerReady()
    await expect.poll(contrast).toBeGreaterThan(4.5)
    await page.reload(); await expect(hint).toBeVisible(); await readerReady()
    await expect.poll(contrast).toBeGreaterThan(4.5)
    await hint.screenshot({ path: info.outputPath('vim-hint-dark.png') })
    await hint.click()
    let overlay = page.locator('[data-bmux-vim]'), editor = overlay.getByRole('textbox', { name: 'Vim text' })
    await expect(editor).toBeFocused(); await editor.pressSequentially('gg0vll')
    await expect(overlay).toHaveAttribute('data-mode', 'VISUAL')
    let selection = overlay.locator('.cm-selectionBackground').first()
    await expect(selection).toBeVisible()
    await expect.poll(() => selection.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
    await overlay.screenshot({ path: info.outputPath('vim-visual-selection-dark.png') })
    await editor.press('Escape'); await editor.press('Escape'); await expect(overlay).toHaveCount(0)
  } finally {
    await dark('off')
  }
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('style.darkreader').length)).toBe(0)
  await expect(hint).toBeVisible(); await expect.poll(contrast).toBeGreaterThan(4.5)
})

test('website Vim editor stays inline and restores the original field and layout', async ({}, info) => {
  let field = page.locator('#notes'), next = page.locator('#password')
  await field.evaluate(element => {
    element.style.setProperty('display', 'block', 'important')
    element.style.setProperty('background-color', 'rgb(240, 245, 250)')
    ;(window as any).originalVimField = element
  })
  let before = await field.boundingBox(), nextBefore = await next.boundingBox()
  let { overlay, editor } = await open(field)
  await expect(field).toBeHidden()
  expect(await overlay.evaluate(element => ({
    inline: getComputedStyle(element).position === 'static',
    popup: element.hasAttribute('popover'),
    original: element.previousElementSibling === (window as any).originalVimField,
    color: getComputedStyle(element.shadowRoot!.querySelector('.cm-editor')!).backgroundColor,
  }))).toEqual({ inline: true, popup: false, original: true, color: 'rgb(240, 245, 250)' })
  let bounds = await overlay.boundingBox(), nextDuring = await next.boundingBox()
  expect(bounds!.width).toBeCloseTo(before!.width, 0)
  expect(nextDuring!.y - bounds!.y).toBeGreaterThan(nextBefore!.y - before!.y)
  await page.screenshot({ path: info.outputPath('vim-inline.png') })
  await editor.pressSequentially('A draft'); await editor.press('Escape')
  // A framework redraw can detach injected siblings; preserve the draft inline.
  await overlay.evaluate(element => element.remove())
  await expect(editor).toBeVisible(); await expect(editor).toContainText('draft')
  await editor.click(); await ex(editor, 'q')
  await expect(overlay).toHaveCount(0); await expect(field).toBeVisible(); await expect(field).toBeFocused()
  expect(await field.evaluate(element => ({
    same: element === (window as any).originalVimField,
    display: element.style.getPropertyValue('display'),
    priority: element.style.getPropertyPriority('display'),
    background: element.style.backgroundColor,
  }))).toEqual({ same: true, display: 'block', priority: 'important', background: 'rgb(240, 245, 250)' })
  await expect(field).toHaveValue('alpha bravo\ncharlie delta')
  let after = await field.boundingBox(), nextAfter = await next.boundingBox()
  expect(nextAfter!.y - after!.y).toBeCloseTo(nextBefore!.y - before!.y, 0)
  await field.evaluate(element => element.removeAttribute('style'))
})

test('website Vim editor has relative numbers, visible visual selection, and zz save-and-close', async ({}, info) => {
  let field = page.locator('#notes'), { overlay, editor } = await open(field)
  await expect(overlay.locator('.footer')).toHaveCount(0)
  await expect(overlay.getByRole('button', { name: /^(Save|Discard)$/ })).toHaveCount(0)
  await editor.pressSequentially('gg0')
  let numbers = overlay.locator('.cm-lineNumbers .cm-gutterElement').filter({ visible: true })
  // The first gutter element is the width spacer, followed by the document lines.
  await expect(numbers).toHaveText(['1', '1'])
  await editor.press('j'); await expect(numbers).toHaveText(['1', '2'])
  await editor.pressSequentially('gg0vll')
  await expect(overlay).toHaveAttribute('data-mode', 'VISUAL')
  let selection = overlay.locator('.cm-selectionBackground').first()
  await expect(selection).toBeVisible()
  await expect.poll(() => selection.evaluate(element => {
    let style = getComputedStyle(element), bounds = element.getBoundingClientRect()
    return style.backgroundColor !== 'rgba(0, 0, 0, 0)' && bounds.width > 0 && bounds.height > 0
  })).toBe(true)
  await overlay.screenshot({ path: info.outputPath('vim-visual-selection.png') })
  await editor.press('Escape'); await expect(overlay).toHaveAttribute('data-mode', 'NORMAL')
  await editor.pressSequentially('A draft'); await editor.press('Escape'); await editor.pressSequentially('zz')
  await expect(overlay).toHaveCount(0); await expect(field).toHaveValue('alpha bravo draft\ncharlie delta')
  ;({ overlay, editor } = await open(field))
  await editor.pressSequentially('gg0A!'); await editor.press('Escape'); await editor.pressSequentially('ZZ')
  await expect(overlay).toHaveCount(0); await expect(field).toHaveValue('alpha bravo draft!\ncharlie delta')
  await field.fill('alpha bravo\ncharlie delta')
})

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

test('website Vim yanks share the system clipboard across editors and browser fields', async () => {
  let { overlay, editor } = await open(page.locator('#notes'))
  await editor.pressSequentially('gg0yy')
  await expect.poll(() => application.evaluate(({ clipboard }) => clipboard.readText())).toBe('alpha bravo\n')
  await ex(editor, 'q')
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.press('P')
  await expect(address).toHaveValue('alpha bravo' + page.url())
  await address.press('i'); await address.fill('from browser'); await address.press('Escape'); await address.press('y'); await address.press('y')
  await expect.poll(() => application.evaluate(({ clipboard }) => clipboard.readText())).toBe('from browser')
  await chrome.getByRole('button', { name: 'Close URL search', exact: true }).click()
  ;({ overlay, editor } = await open(page.locator('#text')))
  await editor.pressSequentially('gg0P')
  await expect(editor).toContainText('from browseralpha bravo')
  await editor.pressSequentially('gg0vey')
  await expect.poll(() => application.evaluate(({ clipboard }) => clipboard.readText())).toBe('from')
  await application.evaluate(({ clipboard }) => clipboard.writeText('outside '))
  await editor.pressSequentially('gg0P')
  await expect(editor).toContainText('outside from browseralpha bravo')
  await ex(editor, 'q')
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
  await expect(overlay).toBeVisible(); await expect(field).toBeHidden(); await expect(editor).toBeFocused()
  await editor.pressSequentially('A!'); await editor.press('Escape'); await editor.press('Escape')
  await expect(overlay).toHaveCount(0); await expect(field).toHaveValue('saved!')
  await expect(page.locator('#controlled-value')).toHaveText('saved!'); await expect(field).toBeFocused()
})

test('website Vim editor updates rich text and shadow fields through native events', async () => {
  let rich = page.locator('#rich'), { overlay, editor } = await open(rich)
  await editor.pressSequentially('ggVGc'); await editor.pressSequentially('new  first'); await editor.press('Enter'); await editor.pressSequentially('new second'); await editor.press('Escape')
  await ex(editor, 'wq')
  expect(await rich.textContent()).toContain('new  first')
  expect((await rich.innerText()).replace(/\u00a0/g, ' ')).toBe('new first\nnew second')
  await expect(overlay).toHaveCount(0)
  let shadow = page.locator('#shadow-text')
  ;({ overlay, editor } = await open(shadow))
  await editor.pressSequentially('gg0cw'); await editor.pressSequentially('edited'); await editor.press('Escape')
  await ex(editor, 'wq')
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
  await ex(editor, 'q')
  await expect(overlay).toHaveCount(0)
  for (let id of ['password', 'readonly', 'number']) {
    let input = page.locator(`#${id}`)
    await input.click(); await input.press('Meta+e')
    await expect(page.locator('[data-bmux-vim]')).toHaveCount(0)
  }
  ;({ overlay, editor } = await open(field))
  await editor.pressSequentially('A retained draft'); await editor.press('Escape')
  await field.evaluate(element => element.remove())
  await expect(overlay).toContainText('Field no longer available')
  await expect(editor).toContainText('retained draft')
  await ex(editor, 'q')
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
      await field.press('Meta+e')
      return frame.locator('[data-bmux-vim]').count()
    }).toBe(1)
    let overlay = frame.locator('[data-bmux-vim]'), editor = overlay.getByRole('textbox', { name: 'Vim text' })
    await editor.pressSequentially('gg0cw'); await editor.pressSequentially('frame'); await editor.press('Escape')
    await editor.pressSequentially(':wq')
    await frame.locator('[data-bmux-vim] .cm-vim-panel input').press('Enter')
    await expect(field).toHaveValue('frame bravo'); await expect(field).toBeFocused()
  }
  await fs.writeFile(config, 'vimEditing: false\naccessibility: true\nkeyboard:\n  shortcuts:\n    Ctrl+E: null\n    Cmd+E: vim-editor\nbrowser:\n  adblock: false\n  autoUpdateFilters: false\n')
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await expect.poll(() => chrome.evaluate(async () => (window as any).bmux.state().then((state: any) => state.vimEditing))).toBe(false)
  // Explicitly await page-tools refresh instead of racing its configuration queue.
  await chrome.evaluate(async () => (window as any).bmux.command({ method: 'browser.reload-scripts', args: {} }))
  let field = page.locator('#notes')
  await field.click(); await field.press('Meta+e')
  await expect(page.locator('[data-bmux-vim]')).toHaveCount(0)
  await expect(page.locator('[data-bmux-vim-hints]')).toHaveCount(0)
})
