import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { closeTestApplication } from './electron-fixture'

let application: ElectronApplication, page: Page, directory: string, server: http.Server, config: string
let pageErrors: string[] = []
let fixture = `<!doctype html><title>Vim field fixture</title>
<link rel="stylesheet" href="/fixture.css">
<form><input id="text" value="alpha bravo"><textarea id="notes">alpha bravo\ncharlie delta</textarea><input id="password" type="password"><input id="readonly" readonly value="locked"><input id="number" type="number"></form>
<div id="rich" contenteditable="true"><p>alpha bravo</p><p>charlie delta</p></div>
<output id="notes-count">25</output><output id="rich-count"></output><div id="react"></div><div id="draft"></div><form id="search-form"><input id="map-search" role="combobox" name="q"><output id="search-result"></output></form><div id="shadow"></div><button id="outside">Outside</button>
<script nonce="bmux-fixture" src="/fixture.js"></script>`

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-page-vim-'))
  config = path.join(directory, 'config.yaml')
  await fs.writeFile(config, 'accessibility: true\nkeyboard:\n  shortcuts:\n    Ctrl+E: null\n    Cmd+E: vim-editor\n    h: { action: reload, when: pane-not-editing }\n    j: { action: scroll-down, when: pane-not-editing }\nbrowser:\n  adblock: false\n  autoUpdateFilters: false\n')
  let bundle = await build({ stdin: { contents: `
    import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
    import { Editor, EditorState, ContentState } from 'draft-js';
    let Form = () => { let [value, setValue] = useState('controlled'); return React.createElement(React.Fragment, null, React.createElement('input', { id: 'controlled', value, onChange: e => setValue(e.target.value) }), React.createElement('output', { id: 'controlled-value' }, value)); };
    createRoot(document.querySelector('#react')).render(React.createElement(Form));
    let Composer = () => {
      let [state, setState] = useState(() => EditorState.createWithContent(ContentState.createFromText('draft seed\\nsecond line')));
      let text = state.getCurrentContent().getPlainText();
      return React.createElement(React.Fragment, null,
        React.createElement(Editor, { editorState: state, onChange: setState, ariaLabel: 'Draft composer' }),
        React.createElement('output', { id: 'draft-model' }, text),
        React.createElement('output', { id: 'draft-count' }, String(text.length)));
    };
    createRoot(document.querySelector('#draft')).render(React.createElement(Composer));
    document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML = '<textarea id="shadow-text">shadow draft</textarea>';
    window.fixtureEvents = { input: 0, change: 0, submit: 0, keys: 0 };
    document.addEventListener('input', () => window.fixtureEvents.input++);
    document.querySelector('#notes').addEventListener('input', e => { document.querySelector('#notes-count').textContent = String(e.target.value.length); });
    window.richEvents = [];
    document.querySelector('#rich').addEventListener('beforeinput', e => { window.richEvents.push({ type: 'beforeinput', data: e.data, html: e.target.innerHTML }); });
    document.querySelector('#rich').addEventListener('input', e => { document.querySelector('#rich-count').textContent = e.target.textContent; window.richEvents.push({ type: 'input', data: e.data, html: e.target.innerHTML }); });
    document.addEventListener('change', () => window.fixtureEvents.change++);
    document.addEventListener('keydown', () => window.fixtureEvents.keys++);
    document.querySelector('form').addEventListener('submit', e => { e.preventDefault(); window.fixtureEvents.submit++; });
    window.searchQuery = '';
    document.querySelector('#map-search').addEventListener('input', e => {
      window.searchQuery = e.target.value; document.querySelector('#outside').focus();
      queueMicrotask(() => { let active = document.activeElement; while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement; active?.blur(); });
      setTimeout(() => document.querySelector('[data-bmux-vim]')?.remove(), 0);
    });
    document.querySelector('#search-form').addEventListener('submit', e => { e.preventDefault(); document.querySelector('#search-result').textContent = window.searchQuery; });
  `, resolveDir: process.cwd(), sourcefile: 'page-vim-fixture.js' }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"development"', global: 'globalThis' } })
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': request.url === '/fixture.js' ? 'text/javascript' : request.url === '/fixture.css' ? 'text/css' : 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'nonce-bmux-fixture'; frame-src 'self' http://localhost:*" })
    response.end(request.url === '/fixture.js' ? bundle.outputFiles[0].text : request.url === '/fixture.css' ? 'body { padding: 30px; font: 16px sans-serif; } textarea, input, [contenteditable] { display: block; width: 450px; margin: 10px; } [contenteditable] { min-height: 60px; border: 1px solid #888; }' : fixture)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/fields`
  application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: config, BMUX_BACKGROUND: '0' } })
  pageErrors = []
  application.context().on('page', fixturePage => fixturePage.on('pageerror', error => pageErrors.push(error.stack ?? error.message)))
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

test('website Vim initializes without document-start errors after navigation and reload', async () => {
  expect(pageErrors).toEqual([])
  for (let reload = 0; reload < 3; reload++) {
    await page.reload()
    await expect(page.locator('#controlled')).toHaveValue('controlled')
    await expect(page.locator('[data-bmux-vim-hints] button[aria-controls="notes"]')).toHaveCount(1)
    let { editor, overlay } = await open(page.locator('#notes'))
    await editor.press('Escape')
    await expect(overlay).toHaveCount(0)
    expect(pageErrors).toEqual([])
  }
})

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
  await expect(editor).toBeVisible(); await expect(editor).toContainText('draft'); await expect(editor).toBeFocused()
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
  await expect(field).toHaveValue('alpha bravo\nchanged delta')
  await overlay.screenshot({ path: info.outputPath('vim-editor.png') })
  let keys = await page.evaluate(() => (window as any).fixtureEvents.keys)
  await ex(editor, 'wq')
  await expect(overlay).toHaveCount(0); await expect(field).toBeFocused()
  await expect(field).toHaveValue('alpha bravo\nchanged delta')
  expect(await page.evaluate(() => (window as any).fixtureEvents.submit)).toBe(0)
  expect(await page.evaluate(() => (window as any).fixtureEvents.keys)).toBe(keys)
})

test('website Vim edits update page counts and native selections before saving', async () => {
  let field = page.locator('#notes')
  await field.fill('alpha bravo\nchanged delta')
  let { overlay, editor } = await open(field)
  await editor.pressSequentially('gg0vll')
  await expect.poll(() => field.evaluate(element => {
    let input = element as HTMLTextAreaElement
    return [input.selectionStart, input.selectionEnd, input.selectionDirection]
  })).toEqual([0, 3, 'forward'])
  await expect(editor).toBeFocused()
  await editor.press('Escape'); await editor.pressSequentially('gg0llvhh')
  await expect.poll(() => field.evaluate(element => {
    let input = element as HTMLTextAreaElement
    return [input.selectionStart, input.selectionEnd, input.selectionDirection]
  })).toEqual([0, 3, 'backward'])
  await editor.press('Escape'); await editor.pressSequentially('gg0A!')
  await expect(field).toHaveValue('alpha bravo!\nchanged delta')
  await expect(page.locator('#notes-count')).toHaveText(String('alpha bravo!\nchanged delta'.length))
  await expect(editor).toBeFocused(); await editor.press('Escape'); await editor.press('u')
  await expect(field).toHaveValue('alpha bravo\nchanged delta')
  await expect(page.locator('#notes-count')).toHaveText(String('alpha bravo\nchanged delta'.length))
  await editor.pressSequentially('A saved'); await editor.press('Escape'); await ex(editor, 'w')
  await editor.pressSequentially('A discarded'); await editor.press('Escape'); await ex(editor, 'q')
  await expect(overlay).toHaveCount(0)
  await expect(field).toHaveValue('alpha bravo saved\nchanged delta')
  await expect(page.locator('#notes-count')).toHaveText(String('alpha bravo saved\nchanged delta'.length))
  await field.fill('alpha bravo\nchanged delta')
})

test('website Vim yanks share the system clipboard across editors and browser fields', async () => {
  await page.locator('#notes').fill('alpha bravo\ncharlie delta')
  let { overlay, editor } = await open(page.locator('#notes'))
  await editor.pressSequentially('gg0yy')
  await expect.poll(() => application.evaluate(({ clipboard }) => clipboard.readText())).toBe('alpha bravo\n')
  await editor.pressSequentially('dd')
  await expect(editor).not.toContainText('alpha bravo')
  await editor.pressSequentially('x')
  await expect(editor).toContainText('harlie delta')
  // Read through the native queue so any preceding clipboard writes have settled.
  let chromeClipboard = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  expect(await chromeClipboard.evaluate(() => (window as any).bmux.clipboard())).toBe('alpha bravo\n')
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

test('website Vim skips OTP and short fields while preserving native code entry', async () => {
  await page.evaluate(() => {
    let fixture = document.createElement('section'); fixture.id = 'otp-fixture'
    fixture.innerHTML = `<div style="display:flex">${Array.from({ length: 6 }, (_, index) => `<input id="otp-${index}" maxlength="1" style="width:56px">`).join('')}</div><input id="short-code" maxlength="6"><input id="autofill-code" autocomplete="section-login one-time-code"><input id="numeric-code" inputmode="numeric"><input id="decimal-code" inputmode="decimal"><input id="long-text" maxlength="7">`
    fixture.addEventListener('input', event => {
      let field = event.target as HTMLInputElement
      if (field.id.startsWith('otp-') && field.value) (field.nextElementSibling as HTMLInputElement | null)?.focus()
    })
    document.body.prepend(fixture)
  })
  try {
    let hints = page.locator('[data-bmux-vim-hints]')
    await expect(hints.locator('button[aria-controls="long-text"]')).toBeVisible()
    for (let id of [...Array.from({ length: 6 }, (_, index) => `otp-${index}`), 'short-code', 'autofill-code', 'numeric-code', 'decimal-code']) {
      await expect(hints.locator(`button[aria-controls="${id}"]`)).toHaveCount(0)
      let field = page.locator(`#${id}`)
      await field.click(); await field.press('Meta+e')
      await expect(page.locator('[data-bmux-vim]')).toHaveCount(0)
      await expect(field).toBeFocused()
    }
    await page.locator('#otp-0').click()
    await page.keyboard.type('123456')
    for (let index = 0; index < 6; index++) await expect(page.locator(`#otp-${index}`)).toHaveValue(String(index + 1))
    let field = page.locator('#long-text'), hint = hints.locator('button[aria-controls="long-text"]')
    await field.evaluate(element => element.setAttribute('maxlength', '1'))
    await expect(hint).toHaveCount(0)
    await field.evaluate(element => element.removeAttribute('maxlength'))
    await expect(hint).toBeVisible()
    for (let [attribute, value] of [['autocomplete', 'one-time-code'], ['inputmode', 'numeric']]) {
      await field.evaluate((element, [attribute, value]) => element.setAttribute(attribute, value), [attribute, value])
      await expect(hint).toHaveCount(0)
      await field.evaluate((element, attribute) => element.removeAttribute(attribute), attribute)
      await expect(hint).toBeVisible()
    }
  } finally { await page.locator('#otp-fixture').evaluate(element => element.remove()) }
})

test('website Vim editor discards drafts, writes controlled React inputs, and exits with Escape', async () => {
  let field = page.locator('#controlled'), { overlay, editor } = await open(field)
  await editor.pressSequentially('gg0cc'); await editor.pressSequentially('discarded'); await editor.press('Escape')
  await expect(field).toHaveValue('discarded'); await expect(page.locator('#controlled-value')).toHaveText('discarded')
  await expect(editor).toBeFocused()
  await ex(editor, 'q')
  await expect(overlay).toHaveCount(0); await expect(field).toHaveValue('controlled')
  await expect(page.locator('#controlled-value')).toHaveText('controlled')
  ;({ overlay, editor } = await open(field))
  await editor.pressSequentially('gg0cc'); await editor.pressSequentially('saved'); await editor.press('Escape')
  await ex(editor, 'w')
  await expect(field).toHaveValue('saved'); await expect(page.locator('#controlled-value')).toHaveText('saved')
  await expect(overlay).toBeVisible(); await expect(field).toBeHidden(); await expect(editor).toBeFocused()
  await editor.pressSequentially('A!'); await editor.press('Escape'); await editor.press('Escape')
  await expect(overlay).toHaveCount(0); await expect(field).toHaveValue('saved!')
  await expect(page.locator('#controlled-value')).toHaveText('saved!'); await expect(field).toBeFocused()
})

test('website Vim editor updates rich text and shadow fields through native events', async ({}, info) => {
  let rich = page.locator('#rich'), { overlay, editor } = await open(rich)
  await editor.pressSequentially('ggVGc'); await editor.pressSequentially('new  first'); await editor.press('Enter'); await editor.pressSequentially('new second'); await editor.press('Escape')
  await fs.writeFile(info.outputPath('rich-live-events.json'), JSON.stringify(await page.evaluate(() => ({ html: document.querySelector('#rich')!.innerHTML, events: (window as any).richEvents }))))
  await expect(editor).toContainText('new second')
  await expect(overlay.locator('.shell > :not(.editor)')).toHaveCount(0)
  await expect(page.locator('#rich-count')).toContainText('new second')
  expect(await rich.textContent()).toContain('new  first')
  await expect(editor).toBeFocused()
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

test('website Vim keeps Draft.js model, counter, native typing and Escape working', async ({}, info) => {
  let field = page.getByRole('textbox', { name: 'Draft composer' }), { overlay, editor } = await open(field)
  let model = page.locator('#draft-model'), count = page.locator('#draft-count')
  await editor.pressSequentially('Awh')
  await expect(editor).toContainText('second linewh')
  await expect(model).toHaveText('draft seed\nsecond linewh')
  await expect(count).toHaveText('24')
  await expect(editor).toBeFocused()
  await editor.press('Escape'); await editor.pressSequentially('ggVGc')
  await editor.pressSequentially('first line'); await editor.press('Enter'); await editor.pressSequentially('second  line')
  await expect(model).toHaveText('first line\nsecond  line')
  await expect(count).toHaveText('23')
  await expect(editor).toBeFocused()
  await overlay.screenshot({ path: info.outputPath('vim-draft-counter.png') })
  await editor.press('Escape'); await editor.press('Escape')
  await expect(overlay).toHaveCount(0); await expect(field).toBeFocused()
  await field.press('Meta+ArrowRight'); await field.pressSequentially(' native')
  await expect(model).toHaveText('first line\nsecond  line native')
  await expect(count).toHaveText('30')
  await expect(field).toHaveText('first linesecond  line native')
  ;({ overlay, editor } = await open(field))
  await editor.pressSequentially('ggVGd')
  await expect(model).toHaveText(''); await expect(count).toHaveText('0')
  await editor.pressSequentially('irecovered'); await editor.press('Escape'); await ex(editor, 'wq')
  await expect(overlay).toHaveCount(0); await expect(model).toHaveText('recovered')
  await field.press('Meta+ArrowRight'); await field.pressSequentially('!'); await expect(model).toHaveText('recovered!')
})

test('website Vim keeps search input focus and submits the updated page query after Escape', async () => {
  let field = page.locator('#map-search'), { overlay, editor } = await open(field)
  await editor.pressSequentially('iwh')
  await expect(editor).toBeFocused(); await expect(field).toHaveValue('wh')
  await editor.pressSequentially('ere to eat in Bangkok')
  await expect(editor).toBeFocused(); await expect(field).toHaveValue('where to eat in Bangkok')
  await editor.press('Escape'); await editor.press('Escape')
  await expect(overlay).toHaveCount(0); await expect(field).toBeFocused()
  await field.press('Enter'); await expect(page.locator('#search-result')).toHaveText('where to eat in Bangkok')
})

test('website Vim suppresses pane shortcuts even if a composer blurs the editor', async () => {
  let { overlay, editor } = await open(page.locator('#notes'))
  await editor.pressSequentially('A')
  let navigations = 0, navigated = () => { navigations++ }
  page.on('framenavigated', navigated)
  try {
    await page.locator('#outside').focus()
    await expect.poll(() => application.evaluate(async ({ webContents }, url) => {
      let contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      let { frameTree } = await contents.debugger.sendCommand('Page.getFrameTree')
      let { executionContextId } = await contents.debugger.sendCommand('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'bmux:keyboard-focus' })
      let { result } = await contents.debugger.sendCommand('Runtime.evaluate', { contextId: executionContextId, expression: 'globalThis.bmuxVimEditing === true', returnByValue: true })
      return result.value
    }, page.url())).toBe(true)
    await application.evaluate(({ webContents }) => {
      let contents = webContents.getFocusedWebContents()!
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'h' }); contents.sendInputEvent({ type: 'keyUp', keyCode: 'h' })
    })
    await editor.focus(); await editor.pressSequentially('wh')
    await expect(editor).toContainText('wh'); await expect(overlay).toBeVisible()
    expect(navigations).toBe(0)
    await editor.press('Escape'); await editor.press('Escape'); await expect(overlay).toHaveCount(0)
  } finally { page.off('framenavigated', navigated) }
})

test('website Vim editor preserves conflicting drafts and handles removed, disabled, and password fields', async () => {
  let field = page.locator('#text'), { overlay, editor } = await open(field)
  await editor.pressSequentially('A draft'); await editor.press('Escape')
  await field.evaluate(element => { (element as HTMLInputElement).value = 'page update' })
  await editor.pressSequentially('A!'); await editor.press('Escape')
  await expect(field).toHaveValue('page update')
  await ex(editor, 'wq')
  await expect(overlay).toBeVisible()
  await expect(overlay.locator('.shell > :not(.editor)')).toHaveCount(0)
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
  await expect(overlay).toBeVisible()
  await expect(overlay.locator('.shell > :not(.editor)')).toHaveCount(0)
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
