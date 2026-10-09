import { test, expect, type ElectronApplication } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'

let exec = promisify(execFile)

for (let picker of ['input', 'input-interception', 'input-background', 'input-switch-race', 'input-frame', 'input-frame-media', 'input-frame-popup', 'showOpenFilePicker']) test(`native image upload via ${picker} opens a picker and receives the chosen file`, async ({}, info) => {
  test.setTimeout(60_000)
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-native-file-picker-'))
  let uploads = await fs.mkdtemp(path.join(os.homedir(), 'Downloads', 'bmux-upload-fixture-'))
  let png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
  let selected = ''
  let uploaded = Buffer.alloc(0)
  let writePermission = ''
  let pickerError = ''
  let clicks = 0
  let server = http.createServer((request, response) => {
    let url = new URL(request.url!, 'http://fixture')
    if (url.pathname === '/selected') {
      selected = url.searchParams.get('name') ?? ''
      writePermission = url.searchParams.get('writePermission') ?? ''
      request.on('data', chunk => { uploaded = Buffer.concat([uploaded, chunk]) })
    }
    if (url.pathname === '/error') pickerError = url.searchParams.get('message') ?? ''
    if (url.pathname === '/clicked') clicks++
    response.setHeader('Content-Type', 'text/html')
    if (url.pathname === '/fixture' && picker === 'input-frame-popup') {
      response.end('<!doctype html><title>Review opener</title><button id="image" style="position:fixed;inset:0" onclick="fetch(\'/clicked\');window.open(\'/popup\')">Open review</button>')
      return
    }
    if ((url.pathname === '/fixture' || url.pathname === '/popup') && picker.startsWith('input-frame')) {
      response.end('<!doctype html><title>Embedded review upload</title><iframe name="review" src="/frame" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>')
      return
    }
    response.end(`<!doctype html><title>Native image upload</title>
      <style>button{position:fixed;inset:0;font:32px sans-serif;background:#e8eef8}</style>
      <button id="image">Image</button><input id="file" type="file" accept="${picker === 'input-frame-media' ? 'image/*,video/*' : 'image/*'}" multiple hidden>
      <script>
        let reportError = error => fetch('/error?message=' + encodeURIComponent(error.name + ': ' + error.message));
        let upload = async (file, writePermission = '') => fetch('/selected?' + new URLSearchParams({name: file.name, writePermission}), {method: 'POST', body: await file.arrayBuffer()});
        document.querySelector('#image').onclick = async () => {
          fetch('/clicked');
          try {
            if (${JSON.stringify(picker)} === 'showOpenFilePicker') {
              let [handle] = await window.showOpenFilePicker({multiple: true, types: [{description: 'Images', accept: {'image/png': ['.png']}}]});
              await upload(await handle.getFile(), await handle.queryPermission({mode: 'readwrite'}));
            } else document.querySelector('#file').click();
          } catch (error) { reportError(error); }
        };
        document.querySelector('#file').onchange = event => upload(event.target.files[0]).catch(reportError);
      </script>`)
  })
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard:\n  shortcuts:\n    Cmd+L: address\nbrowser:\n  autoUpdateFilters: false\n')
  let file = path.join(uploads, 'sample.png')
  await fs.writeFile(file, png)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/fixture`
  let socket = path.join('/tmp', `bmux-${process.getuid?.() ?? 'user'}`, `${createHash('sha256').update(directory).digest('hex').slice(0, 16)}.sock`)
  let commands: string[] = []
  let rpc = (method: string, args: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
    commands.push(`start ${method} ${JSON.stringify(args)}`)
    let connection = net.createConnection(socket), response = ''
    connection.setEncoding('utf8'); connection.setTimeout(5000)
    connection.on('connect', () => connection.write(JSON.stringify({ method, args }) + '\n'))
    connection.on('data', chunk => { response += chunk })
    connection.on('timeout', () => connection.destroy(new Error(`Fixture browser did not respond to ${method}`)))
    connection.on('error', reject)
    connection.on('end', () => {
      try { let result = JSON.parse(response); if (!result.ok) throw new Error(result.error); commands.push(`done ${method}`); resolve(result.result) }
      catch (error) { reject(error) }
    })
  })
  // Launch normally: ElectronApplication would attach a second debugger to every page.
  let packaged = process.env.BMUX_TEST_PACKAGED === '1'
  let executable = packaged ? path.join(process.cwd(), 'build/bmux.app/Contents/MacOS/bmux') : createRequire(import.meta.url)('electron')
  let child = spawn(executable, packaged ? [] : [process.cwd()], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let errors = ''
  let pickerLookupError = ''
  child.stderr.on('data', chunk => { errors += String(chunk) })
  let apple = (source: string) => exec('/usr/bin/osascript', ['-e', source], { timeout: 5000 })
  try {
    await expect.poll(() => rpc('diagnostics').then(state => state.pid).catch(() => null), { timeout: 20_000 }).toBe(child.pid)
    let state = await rpc('state')
    await rpc('activate-client', { client: state.model.clients[0].id })
    await apple(`tell application "System Events"\nkeystroke "l" using command down\ndelay 0.2\nkeystroke "${url}"\nkey code 36\nend tell`)
    await expect.poll(() => rpc('state').then(state => state.model.sessions[0].windows[0].panes[0].url)).toBe(url)
    let paneId = state.model.sessions[0].windows[0].panes[0].id
    let frameReady = 'typeof document.querySelector("iframe")?.contentDocument?.querySelector("#image")?.onclick === "function"'
    await rpc('wait', { tab: paneId, expression: picker.startsWith('input-frame') && picker !== 'input-frame-popup' ? frameReady : 'typeof document.querySelector("#image")?.onclick === "function"' })
    if (picker === 'input-interception') {
      await rpc('cdp', { tab: paneId, method: 'Page.setInterceptFileChooserDialog', params: { enabled: true } })
      await rpc('cdp', { tab: paneId, method: 'Runtime.evaluate', params: { expression: 'document.querySelector("#image").click()', userGesture: true } })
      await expect.poll(() => clicks).toBe(1)
      expect((await apple(`tell application "System Events" to tell first application process whose unix id is ${child.pid} to get exists sheet 1 of window 1`)).stdout.trim()).toBe('false')
      await rpc('cdp', { tab: paneId, method: 'Page.setInterceptFileChooserDialog', params: { enabled: false } })
    }
    if (['input-background', 'input-switch-race'].includes(picker)) {
      let other = await rpc('new-window', { session: state.model.sessions[0].id, url: 'about:blank' })
      if (picker === 'input-background') await rpc('select-window', { client: state.model.clients[0].id, window: other.id })
      await fs.writeFile(info.outputPath('background-before-click.json'), JSON.stringify(await rpc('eval', { tab: paneId, expression: '({open:document.querySelector("#file").matches(":open"),visible:document.visibilityState})' })))
      if (picker === 'input-switch-race') {
        await rpc('cdp', { tab: paneId, method: 'Runtime.evaluate', params: { expression: 'document.querySelector("#image").click()', userGesture: true } })
        await rpc('select-window', { client: state.model.clients[0].id, window: other.id })
      } else await rpc('click', { tab: paneId, selector: '#image' })
      await expect.poll(() => clicks).toBe(1)
      await fs.writeFile(info.outputPath('background-picker.json'), JSON.stringify(await rpc('eval', { tab: paneId, expression: '({open:document.querySelector("#file").matches(":open"),visible:document.visibilityState})' })))
      await rpc('select-pane', { client: state.model.clients[0].id, pane: paneId })
      if ((await apple(`tell application "System Events" to tell first application process whose unix id is ${child.pid} to get exists sheet 1 of window 1`)).stdout.trim() === 'true') {
        await apple(`tell application "System Events"
          tell first application process whose unix id is ${child.pid}
            set panel to sheet 1 of window 1
            if exists button "Cancel" of panel then
              click button "Cancel" of panel
            else
              click button "Cancel" of splitter group 1 of panel
            end if
          end tell
        end tell`)
        await expect.poll(async () => (await apple(`tell application "System Events" to tell first application process whose unix id is ${child.pid} to get exists sheet 1 of window 1`)).stdout.trim()).toBe('false')
      }
      await rpc('focus-page', { client: state.model.clients[0].id })
      await rpc('wait', { tab: paneId, expression: 'document.visibilityState === "visible" && document.hasFocus()' })
      await fs.writeFile(info.outputPath('background-restored-diagnostics.json'), JSON.stringify((await rpc('diagnostics')).filePickers, null, 2))
    }
    await apple('delay 0.3')
    await exec('/usr/sbin/screencapture', ['-x', info.outputPath('before-image-click.png')])
    let mouse = `ObjC.import('CoreGraphics'); let process=Application('System Events').processes.whose({unixId:${child.pid}})[0]; let window=process.windows[0]; let p=window.position(),s=window.size(); let point=$.CGPointMake(p[0]+80,p[1]+s[1]-100); [5,1,2].forEach(type=>{$.CGEventPost(0,$.CGEventCreateMouseEvent(null,type,point,0));delay(0.08)});`
    await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', mouse], { timeout: 5000 })
    if (picker === 'input-frame-popup') {
      await expect.poll(() => rpc('state').then(current => current.model.clients[0].paneId)).not.toBe(paneId)
      paneId = (await rpc('state')).model.clients[0].paneId
      await rpc('wait', { tab: paneId, expression: frameReady })
      await rpc('focus-page', { client: state.model.clients[0].id })
      await rpc('wait', { tab: paneId, expression: 'document.visibilityState === "visible" && document.hasFocus()' })
      await rpc('cdp', { tab: paneId, method: 'Runtime.evaluate', params: { expression: 'document.querySelector("iframe").contentDocument.querySelector("#image").click()', userGesture: true } })
    }
    await expect.poll(() => clicks).toBe(['input-frame-popup', 'input-interception', 'input-background', 'input-switch-race'].includes(picker) ? 2 : 1)
    await expect.poll(async () => pickerError || (await apple(`tell application "System Events" to tell first application process whose unix id is ${child.pid} to get exists sheet 1 of window 1`)).stdout.trim(), { timeout: 5000 }).toBe('true')
    let pickerTrace = (await rpc('diagnostics')).filePickers
    expect(pickerTrace.events).toContainEqual(expect.objectContaining({ event: 'request', paneId, visible: true }))
    expect(pickerTrace.events).toContainEqual(expect.objectContaining({ event: 'sheet-begin', visible: true }))
    if (picker === 'input-interception') {
      expect(pickerTrace.events.filter((event: { event: string }) => event.event === 'cdp-interception').map((event: { enabled: boolean }) => event.enabled)).toEqual([true, false])
    }
    await fs.writeFile(info.outputPath('file-picker-diagnostics.json'), JSON.stringify(pickerTrace, null, 2))
    await exec('/usr/sbin/screencapture', ['-x', info.outputPath('native-file-picker.png')])
    await apple(`tell application "System Events"\nkeystroke "g" using {command down, shift down}\ndelay 0.3\nkeystroke "${file}"\nkey code 36\nend tell`)
    let openButton = (action: 'enabled' | 'click') => apple(`tell application "System Events"
      tell first application process whose unix id is ${child.pid}
        set panel to sheet 1 of window 1
        if exists button "Open" of panel then
          set openControl to button "Open" of panel
        else
          set openControl to button "Open" of splitter group 1 of panel
        end if
        ${action === 'enabled' ? 'get enabled of openControl' : 'click openControl'}
      end tell
    end tell`)
    await expect.poll(() => openButton('enabled').then(result => result.stdout.trim()).catch(error => { pickerLookupError = String(error); return 'false' })).toBe('true')
    await openButton('click')
    await expect.poll(() => pickerError || selected).toBe('sample.png')
    await expect.poll(() => uploaded.equals(png)).toBe(true)
    if (picker === 'showOpenFilePicker') expect(writePermission).toBe('denied')
  } catch (error) {
    await rpc('diagnostics').then(current => fs.writeFile(info.outputPath('failed-picker-diagnostics.json'), JSON.stringify(current.filePickers, null, 2))).catch(() => undefined)
    await rpc('state').then(async current => {
      let tab = current.model.clients[0].paneId
      let state = await rpc('eval', { tab, expression: '({visible:document.visibilityState,focused:document.hasFocus(),open:document.querySelector("#file")?.matches(":open"),width:innerWidth,height:innerHeight,outerWidth,outerHeight,frame:document.querySelector("iframe")?.getBoundingClientRect().toJSON()})' })
      await fs.writeFile(info.outputPath('popup-page-state.json'), JSON.stringify(state, null, 2))
    }).catch(() => undefined)
    await fs.writeFile(info.outputPath('picker-lookup-error.txt'), pickerLookupError)
    await apple(`tell application "System Events" to tell first application process whose unix id is ${child.pid} to get entire contents of window 1`).then(result => fs.writeFile(info.outputPath('picker-accessibility.txt'), result.stdout)).catch(() => undefined)
    await exec('/usr/sbin/screencapture', ['-x', info.outputPath('native-file-picker-failure.png')]).catch(() => undefined)
    throw error
  } finally {
    await fs.writeFile(info.outputPath('browser-stderr.txt'), errors)
    await fs.writeFile(info.outputPath('commands.json'), JSON.stringify(commands, null, 2))
    // Normal launch still uses the shared bounded process shutdown.
    await closeTestApplication({ process: () => child, close: async () => { child.kill('SIGTERM') } } as ElectronApplication)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
    await fs.rm(uploads, { recursive: true, force: true })
  }
})
