import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { parse, stringify } from 'yaml'
import { observeNativeFocus, recordNativeFocus } from './native-focus'

let directory: string, application: ElectronApplication, chrome: Page, url: string, server: http.Server
let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let state = () => chrome.evaluate(() => (window as any).bmux.state())
let activate = async () => { let current = await state(); await expect.poll(async () => { await rpc('activate-client', { client: current.clientId }); return (await state()).focusedClientId }).toBe(current.clientId) }
let run = async (action: string, args: Record<string, unknown> = {}) => (await rpc('plugin.run', { action: `test/${action}`, ...args })).id as string
let completed = async (id: string, status = 'completed', timeout = 5000) => { await expect.poll(async () => (await rpc('plugin.runs')).find((run: any) => run.id === id)?.status, { timeout }).toBe(status) }
let script = `import { execFileSync } from 'node:child_process';
let host = (method,args={}) => JSON.parse(execFileSync(process.env.BMUX_CLI,['plugin','host',method,'--stdin'],{input:JSON.stringify(args),encoding:'utf8',stdio:['pipe','pipe','pipe']})).result;
let context = host('context'), action = process.argv[2];
if (action === 'pick') {
 let selected = host('ui',{kind:'pick',title:'Fixture login',items:[{id:'first',label:'First user'},{id:'second',label:'Second user'}]});
 host('fill',{origin:new URL(context.url).origin,fields:[{selector:'#username',value:selected},{selector:'#password',value:'disposable-test-password'}]}); host('result',{filled:true});
} else if (action === 'launch') {
 host('navigate',{url:context.launchUrl});
 for(let attempt=0;attempt<100;attempt++){context=host('context',{refresh:true});if(context.url===context.launchUrl)break;await new Promise(resolve=>setTimeout(resolve,50))}
 host('wait',{selector:'#username'});
 let image=host('screenshot',{fullPage:false,encoding:'base64',format:'jpeg',quality:60,maxDimension:768});if(!image.data)throw new Error('No screenshot');
 if(context.parameters.session==='observe'){
  host('overlay.update',{title:'Feed decisions',status:'Browsing',nodes:[{title:'1 Post',lines:['A software demo'],tone:'cyan'}],controls:[{id:'stop',label:'Stop session',kind:'button'},{id:'ads',label:'Skip ads',kind:'toggle',value:false}],details:[{title:'What we sent',text:'Caption and screenshot'},{title:'Full answer',text:'Watch'},{title:'Profile',text:'AI and computers'},{title:'Activity',text:'Observed one post'}]});
  while(!host('overlay.events').some(input=>input.id==='stop'))await new Promise(resolve=>setTimeout(resolve,20));
 }
 host('result',{pane:context.paneId,profile:context.profileId,approved:context.launchApproved,url:context.url,parameters:context.parameters});
} else if (action === 'password') { host('result',{received:context.parameters.password === 'disposable-test-value'});
} else if (action === 'stale') {
 host('progress',{percent:10,message:'Captured document'}); await new Promise(resolve=>setTimeout(resolve,1000));
 try { host('fill',{origin:new URL(context.url).origin,fields:[{selector:'#username',value:'must-not-appear'}]}); process.exit(1) } catch { host('result',{staleRejected:true}) }
} else if (action === 'slow') { await new Promise(resolve=>setTimeout(resolve,30000));
} else if (action === 'wait') { host('wait',{selector:'#never',timeout:30000});
} else if (action === 'ready') { host('eval',{expression:'document.documentElement.dataset.pluginReady="yes"; true'});
} else if (action === 'changed') { host('eval',{expression:'document.documentElement.dataset.pluginChanged="yes"; true'});
} else if (action === 'hidden') {
 try { host('fill',{origin:new URL(context.url).origin,fields:[{selector:'#hidden',value:'must-not-appear'}]}); process.exit(1) } catch { host('result',{hiddenRejected:true}) }
} else if (action === 'title') { host('result',{title:host('eval',{expression:'document.title'})});
} else if (action === 'overlay') {
 let content={copies:[{id:'request-one',label:'Copy sent payload',text:JSON.stringify({image:'x'.repeat(18000),caption:'fixture'})},{id:'response-one',label:'Copy AI payload',text:JSON.stringify({answers:[{name:'watch',choice:'watch'}],usage:{input_tokens:41}})}],title:'Feed training',subtitle:'Fixture profile',status:'Waiting for Start',nodes:[{title:'Post',lines:['A software demo'],tone:'cyan'},{title:'AI answer',lines:['Useful demonstration','Profile match: 98%','Watching: 30s remaining'],tone:'neutral'}],controls:[{id:'start',label:'Start browsing',kind:'button'},{id:'ads',label:'Skip ads',kind:'toggle',value:false}],details:[{title:'Profile',text:'Interested in computers'}]};host('overlay.update',content);
 while(true){
  let inputs=host('overlay.events');
  if(inputs.some(input=>input.id==='finish')){host('overlay.update',{...content,status:'Session complete'});host('result',{started:true});break}
  for(let input of inputs)if(['start','pause','resume'].includes(input.id)){
   let paused=input.id==='pause';content={...content,status:paused?'Paused':'Browsing',controls:[{id:paused?'resume':'pause',label:paused?'Resume session':'Pause session',kind:'button'},{id:'finish',label:'Finish fixture',kind:'button'}]};host('overlay.update',content)
  }
  await new Promise(resolve=>setTimeout(resolve,100))
 }
} else if (action === 'capture') { host('result',host('screenshot',{fullPage:false,encoding:'base64',format:'jpeg',quality:60,maxDimension:768})); }
`
test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-plugin-ui-'))
  let folder = path.join(directory, 'plugins/test'); await fs.mkdir(folder, { recursive: true })
  await fs.cp(path.resolve('examples/plugins/local.page-tools'), path.join(directory, 'plugins/local.page-tools'), { recursive: true })
  await fs.writeFile(path.join(folder, 'run.mjs'), script)
  await fs.writeFile(path.join(folder, 'settings.mjs'), `import fs from 'node:fs';
let file='settings-'+encodeURIComponent(process.env.BMUX_PLUGIN_PROFILE_ID)+'.json';
let values={seconds:'300',ads:false,preset:'observed-fast',review:'auto',ai:true,ai_source:'personal',train:false,visual:true,interactive:false,allow_like:false,persona:'Interested in software'};
if(fs.existsSync(file))Object.assign(values,JSON.parse(fs.readFileSync(file,'utf8')));
if(process.argv[2]==='save'){let input='';for await(const chunk of process.stdin)input+=chunk;Object.assign(values,JSON.parse(input));fs.writeFileSync(file,JSON.stringify(values))}
console.log(JSON.stringify(values));`)

  let action = (id: string) => ({ id, title: id, command: ['node', './run.mjs', id], capabilities: ['browser.read', 'browser.write', 'ui'], timeout_seconds: 40 })
  await fs.writeFile(path.join(folder, 'plugin.yaml'), stringify({ schema_version: 1, id: 'test', name: 'Fixture plugin', category: 'Social Media', description: 'Feed browsing and all platform tools.', version: '1', actions: ['pick', 'stale', 'slow', 'wait', 'hidden', 'title', 'capture', 'overlay'].map(action).concat([{ ...action('launch'), group: 'Browsing', title: 'Simulate feed browsing', description: 'Browse in a new muted window using the active profile. Choose a preset, then adjust settings before starting. This longer description must wrap within its column at every window size.', configuration_command: ['node', './settings.mjs'], configuration_save_command: ['node', './settings.mjs', 'save'], presets: [{ id: 'quick', title: 'Quick browsing', description: 'Five minutes with no interactions.', values: { seconds: '300', ads: false } }, { id: 'training', title: 'Caption training', values: { seconds: '60', ads: true } }], capabilities: ['browser.manage', 'browser.read', 'browser.write', 'ui'], launch_url: 'https://example.test/feed', parameters: [{name:'persona',title:'Persona',kind:'text',multiline:true,section:'Persona'}, { name: 'seconds', title: 'Duration in seconds', kind: 'text', section: 'Session' }, { name: 'ads', title: 'Skip ads', kind: 'boolean', section: 'Interactions', advanced: true }, { name: 'review', title: 'Action approval', kind: 'choice', choices: ['auto', 'confirm'], section: 'Session' }, { name: 'preset', title: 'Browsing pace', kind: 'choice', choices: ['observed-fast', 'observed-balanced', 'remote'], section: 'Playback', advanced: true }, { name: 'ai_source', title: 'AI source', kind: 'choice', choices: ['included', 'personal'], section: 'AI and observation', advanced: true, description: 'BMUX subscription uses your included monthly allowance. A personal OpenAI API key is billed separately by OpenAI.' }, ...[{ name: 'ai', title: 'Visual AI decisions' }, { name: 'train', title: 'Caption training' }, { name: 'visual', title: 'Page overlay' }].map(field => ({ ...field, kind: 'boolean', section: 'AI and observation', advanced: true })), ...[{ name: 'interactive', title: 'Browse comments and profiles' }, { name: 'allow_like', title: 'Allow one like this session' }].map(field => ({ ...field, kind: 'boolean', section: 'Interactions', advanced: true })), { name: 'session', title: 'Session ID', kind: 'text', hidden: true }] } as any, { ...action('password'), group: 'Publishing', parameters: [{ name: 'password', title: 'Fixture password', kind: 'password', required: true }] } as any]), hooks: [{ ...action('ready'), event: 'page-ready', matches: ['http://127.0.0.1:*/*'] }, { ...action('changed'), event: 'url-change', matches: ['http://127.0.0.1:*/*'] }] }))
  await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ automation: { agents: { requireId: true, requireType: true, definitions: { tmux: { fields: { paneId: { label: 'Terminal pane', required: true } } } } } }, browser: { autoUpdateFilters: false }, keyboard: { shortcuts: { 'Cmd+Shift+L': 'plugin:test/pick' } }, plugins: { test: { enabled: true, hooks: true }, 'local.page-tools': { enabled: true } } }))
  server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Plugin fixture</title><h1>Plugin fixture</h1><input id="username" autocomplete="username"><input id="password" type="password"><input id="hidden" type="hidden"><p id="note">Native page content</p>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${(server.address() as any).port}`
  let manifest = parse(await fs.readFile(path.join(folder, 'plugin.yaml'), 'utf8'))
  manifest.actions.find((action: any) => action.id === 'launch').launch_url = url + '/feed'
  await fs.writeFile(path.join(folder, 'plugin.yaml'), stringify(manifest))
  application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_DEBUG: '1' } })
  await observeNativeFocus(application)
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  let current = await state(); await rpc('activate-client', { client: current.clientId })
})
test.afterAll(async () => {
  await closeTestApplication(application).catch(() => undefined)
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
test.afterEach(async ({}, info) => { await recordNativeFocus(application, info) })
test.beforeEach(async ({}, info) => {
  let current = await state(), first = current.model.sessions[0].windows[0]
  await rpc('select-window', { client: current.clientId, window: first.id }); await activate()
  if (!info.title.startsWith('typed URLs')) {
    await rpc('navigate', { tab: first.panes[0].id, url })
    await rpc('wait', { tab: first.panes[0].id, selector: '#username' })
    await activate()
  }
})
test('typed URLs render native pages, hooks execute, and plugin pickers fill the selected login', async () => {
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search' }); await address.fill(url); await address.press('Enter')
  await expect.poll(() => application.context().pages().some(page => page.url().startsWith(url))).toBe(true)
  let page = application.context().pages().find(page => page.url().startsWith(url))!
  await expect(page.locator('html')).toHaveAttribute('data-plugin-ready', 'yes')
  await expect.poll(() => application.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().filter(window => window.isVisible()).some(window => window.contentView.children.some((view: any) => view.webContents?.getURL().startsWith(url) && view.getBounds().height > 100)), url)).toBe(true)
  // Real accelerator originates from the native page.
  await activate(); await rpc('focus-page', { client: (await state()).clientId }); await page.locator('#username').focus()
  await application.evaluate(({ webContents }, url) => {
    let page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(url))!
    page.sendInputEvent({ type: 'keyDown', keyCode: 'L', modifiers: ['meta', 'shift'] })
    page.sendInputEvent({ type: 'keyUp', keyCode: 'L', modifiers: ['meta', 'shift'] })
  }, url)
  let picker = chrome.getByRole('textbox', { name: 'Fixture login' })
  await expect(picker).toBeFocused()
  await fs.mkdir(path.resolve('artifacts'), { recursive: true }); await chrome.screenshot({ path: path.resolve('artifacts/plugin-picker.png') })
  await picker.fill('Second'); await picker.press('Enter')
  await expect(page.locator('#username')).toHaveValue('second'); await expect(page.locator('#password')).toHaveValue('disposable-test-password')
  await expect(picker).toHaveCount(0)
  let current = await state()
  expect(JSON.stringify(current.pluginRuns)).not.toContain('disposable-test-password')
  expect(await page.evaluate(() => ({ node: typeof (window as any).require, bridge: typeof (window as any).bmux }))).toEqual({ node: 'undefined', bridge: 'undefined' })
  await page.evaluate(() => history.pushState({}, '', '/spa'))
  await expect(page.locator('html')).toHaveAttribute('data-plugin-changed', 'yes')
})
test('viewport screenshots preserve visible and hidden device pages without CDP resizing', async () => {
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0]
  let windows = () => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible(), focused: window.isFocused(), bounds: window.getBounds() })))
  try {
    for (let mobile of [false, true]) {
      if (mobile) await rpc('profile.device.set', { pane: pane.id, profile: pane.profileId, device: { preset: 'pixel-8', orientation: 'portrait', locale: 'en-US', timezone: 'UTC' } })
      await rpc('navigate', { pane: pane.id, url })
      await rpc('wait', { pane: pane.id, selector: '#username' })
      let page = application.context().pages().find(page => page.url().startsWith(url))!
      await page.evaluate(() => {
        document.body.style.minHeight = '2600px'
        document.documentElement.style.scrollBehavior = 'auto'
        window.scrollTo(0, 180)
      })
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(180)
      await application.evaluate(({ webContents }, url) => {
        let contents = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(url))!
        let state = globalThis as any
        state.viewportScreenshot = { cdp: 0, native: [] }
        let send = contents.debugger.sendCommand.bind(contents.debugger), capture = contents.capturePage.bind(contents)
        contents.debugger.sendCommand = (method, ...args) => { if (method === 'Page.captureScreenshot') state.viewportScreenshot.cdp++; return send(method, ...args) }
        contents.capturePage = (...args) => {
          let call: { hidden?: boolean; size?: { width: number; height: number } } = { hidden: args[1]?.stayHidden }
          state.viewportScreenshot.native.push(call)
          return capture(...args).then(frame => { call.size = frame.getSize(); return frame })
        }
      }, url)
      for (let hidden of [false, true]) {
        if (hidden) await application.evaluate(({ app }) => app.hide())
        else await activate()
        let beforeWindows = await windows(), beforeSelection = (await state()).model.clients
        let beforePage = await page.evaluate(() => {
          let state = window as any
          state.screenshotChanges = []
          window.addEventListener('resize', () => state.screenshotChanges.push('resize'))
          document.addEventListener('visibilitychange', () => state.screenshotChanges.push('visibility'))
          return { width: innerWidth, height: innerHeight, scrollY, visibility: document.visibilityState, dpr: devicePixelRatio, touch: navigator.maxTouchPoints }
        })
        // Activation can capture a swipe preview; observe only the screenshot requests.
        await application.evaluate(() => { (globalThis as any).viewportScreenshot = { cdp: 0, native: [] } })
        let id = await run('capture', { pane: pane.id })
        await completed(id, 'completed', 10000)
        let result = (await rpc('plugin.runs')).find((item: any) => item.id === id).result
        expect(result).toMatchObject({ pane: pane.id, fullPage: false, format: 'jpeg' })
        expect(Buffer.from(result.data, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8')
        let jpeg = await application.evaluate(({ nativeImage }, data) => nativeImage.createFromBuffer(Buffer.from(data, 'base64')).getSize(), result.data)
        expect(jpeg.width).toBeGreaterThan(0)
        expect(jpeg.height).toBeGreaterThan(0)
        expect(Math.max(jpeg.width, jpeg.height)).toBeLessThanOrEqual(768)
        let output = path.join(directory, `viewport-${mobile}-${hidden}.png`)
        expect(await rpc('screenshot', { pane: pane.id, fullPage: false, output })).toEqual({ pane: pane.id, path: output, fullPage: false })
        let png = await fs.readFile(output)
        expect(png.subarray(1, 4).toString()).toBe('PNG')
        let captures = await application.evaluate(() => (globalThis as any).viewportScreenshot)
        expect(captures.cdp).toBe(0)
        expect(captures.native.length).toBeGreaterThan(0)
        expect(captures.native.every((capture: { hidden: boolean }) => capture.hidden)).toBe(true)
        let size = captures.native.at(-1).size
        expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual(size)
        expect(Math.abs(jpeg.width / jpeg.height - size.width / size.height)).toBeLessThan(0.01)
        expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollY, visibility: document.visibilityState, dpr: devicePixelRatio, touch: navigator.maxTouchPoints }))).toEqual(beforePage)
        expect(await page.evaluate(() => (window as any).screenshotChanges)).toEqual([])
        expect(await windows()).toEqual(beforeWindows)
        expect((await state()).model.clients).toEqual(beforeSelection)
      }
      await activate()
    }
  } finally {
    await activate()
    await rpc('profile.device.clear', { pane: pane.id, profile: pane.profileId })
  }
})
test('password parameters stay private and Escape cancels', async () => {
  await rpc('activate-client', { client: (await state()).clientId })
  let id = await run('password')
  let password = chrome.getByRole('textbox', { name: 'Fixture password' })
  await expect(password).toHaveAttribute('type', 'password')
  for (let attempt = 0; attempt < 3; attempt++) { await activate(); await expect(password).toBeFocused() }
  await password.fill('disposable-test-value')
  await application.evaluate(({ app }) => app.hide())
  await expect.poll(async () => (await state()).focusedClientId).toBeNull()
  await new Promise(resolve => setTimeout(resolve, 700))
  await expect(password).toHaveValue('disposable-test-value')
  await activate(); await password.press('Enter')
  await completed(id)
  expect((await rpc('plugin.runs')).find((item: any) => item.id === id).result).toEqual({ received: true })
  expect(JSON.stringify((await state()).pluginRuns)).not.toContain('disposable-test-value')
  await activate()
  let cancelled = await run('pick'); await expect(chrome.getByRole('textbox', { name: 'Fixture login' })).toBeVisible()
  await chrome.keyboard.press('Escape'); await completed(cancelled, 'cancelled')
})
test('bundled shell/Python examples run from the plugin panel with prompts and results', async () => {
  let current = await state(), windowId = current.model.sessions[0].windows[0].id
  await rpc('select-window', { client: current.clientId, window: windowId }); await activate()
  let title = await rpc('plugin.run', { action: 'local.page-tools/title' }); await completed(title.id)
  expect((await rpc('plugin.runs')).find((item: any) => item.id === title.id).result.result).toBe('Plugin fixture')
  await chrome.getByRole('button', { name: 'Command prompt' }).click()
  let command = chrome.getByRole('combobox', { name: 'Command', exact: true }); await command.fill('plugins'); await command.press('Enter')
  let panel = chrome.getByRole('dialog', { name: 'Plugins', exact: true })
  await expect(panel.getByRole('heading', { name: 'Custom', exact: true })).toBeVisible()
  let plugin = panel.getByRole('button', { name: /^Page tools/ })
  let toggle = panel.getByRole('switch', { name: 'Enable Page tools', exact: true })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await expect(plugin).toHaveText('Page tools')
  await expect(panel.getByRole('region', { name: 'Plugin details' })).toHaveCount(0)
  expect((await rpc('plugin.list')).find((item: any) => item.id === 'local.page-tools').enabled).toBe(false)
  await toggle.click()
  await expect(toggle).toBeChecked()
  await expect(plugin).toHaveText('Page tools')
  let bundled = (await rpc('plugin.list')).find((item: any) => item.bundled)
  expect(bundled).toBeTruthy()
  await expect(panel.getByRole('switch', { name: `Enable ${bundled.name}`, exact: true })).toHaveAttribute('aria-checked', String(bundled.enabled))
  await plugin.click()
  let details = panel.getByRole('region', { name: 'Plugin details' })
  await expect(panel.locator('header').getByRole('button', { name: 'Back to plugins' })).toBeFocused()
  await panel.locator('header').getByRole('button', { name: 'Back to plugins' }).press('Escape')
  await expect(plugin).toBeFocused()
  await plugin.press('i')
  await details.getByRole('button', { name: 'Jump to heading', exact: true }).click()
  let prompt = chrome.getByRole('dialog', { name: 'Plugin', exact: true })
  await expect(prompt.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
  await prompt.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(details.getByRole('button', { name: 'Jump to heading', exact: true })).toBeFocused()
  await expect(panel.getByRole('button', { name: 'Back to plugins' })).toBeVisible()
  await details.getByRole('button', { name: 'Jump to heading', exact: true }).click()
  let picker = chrome.getByRole('textbox', { name: 'Jump to heading', exact: true })
  await expect(picker).toBeFocused()
  let heading = (await state()).pluginPrompt!.runId
  await picker.press('Enter')
  await expect(picker).toHaveCount(0)
  await expect(details).toBeVisible()
  // Python launches another CLI process after the prompt to evaluate and publish
  // the result. Bound that work by its own deadline, after verifying submission.
  await completed(heading, 'completed', 15000)
  expect((await rpc('plugin.runs')).find((item: any) => item.id === heading).result).toEqual({ scrolled: true })
  await activate()
  let annotation = await rpc('plugin.run', { action: 'local.page-tools/annotate' })
  let note = chrome.getByRole('textbox', { name: 'Note', exact: true }); await note.fill('Fixture annotation'); await note.press('Enter'); await completed(annotation.id)
  let tab = (await state()).model.sessions[0].windows[0].panes[0].id
  expect(await rpc('eval', { tab, expression: 'document.querySelector("aside").textContent' })).toBe('Fixture annotation')
})
test('navigation rejects stale fills and hidden fields; plugin waits do not block shortcuts or attachment', async () => {
  await activate()
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0], tab = pane.id
  let stale = await run('stale')
  await expect.poll(async () => (await rpc('plugin.runs')).find((item: any) => item.id === stale)?.progress?.percent).toBe(10)
  await rpc('navigate', { tab, url: `${url}/replacement`, waitUntil: 'none' }); await completed(stale)
  expect((await rpc('plugin.runs')).find((item: any) => item.id === stale).result).toEqual({ staleRejected: true })
  expect(await rpc('eval', { tab, expression: 'document.querySelector("#username").value' })).toBe('')
  await completed(await run('hidden'))
  let waiting = await run('wait'), slow = await run('slow')
  let next = await rpc('new-window', { session: current.model.sessions[0].id, name: 'other' })
  await rpc('select-window', { client: current.clientId, window: next.id })
  await expect(chrome.getByRole('button', { name: '2:other*', exact: true })).toBeVisible()
  await rpc('select-window', { client: current.clientId, window: pane ? current.model.sessions[0].windows[0].id : '' })
  await activate()
  await expect.poll(() => application.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().filter(window => window.isVisible()).some(window => window.contentView.children.some((view: any) => view.webContents?.getURL().startsWith(url))), url)).toBe(true)
  await rpc('plugin.cancel', { id: waiting }); await rpc('plugin.cancel', { id: slow }); await completed(waiting, 'cancelled')
  await activate()
  let pick = await run('pick'); await expect(chrome.getByRole('textbox', { name: 'Fixture login' })).toBeVisible()
  await rpc('select-window', { client: current.clientId, window: next.id }); await completed(pick, 'cancelled')
})

test('plugin overlay sits above the page, resizes, collapses and receives controls', async () => {
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0]
  let capture = async () => { let id = await run('capture', { pane: pane.id }); await completed(id); return (await rpc('plugin.runs')).find((run: any) => run.id === id).result.data }
  let id = await run('overlay', { pane: pane.id })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('#plugin-overlay'))).toBe(true)
  let observer = application.context().pages().find(page => page.url().endsWith('#plugin-overlay'))!
  await expect(observer.getByRole('complementary', { name: 'Page overlay', exact: true })).toBeVisible()
  await expect(observer.getByRole('status')).toHaveText('Waiting for Start')
  await expect(observer.getByRole('button', { name: 'Start browsing', exact: true })).toBeVisible()
  expect((await state()).pluginOverlay.content.copies.every((copy: any) => copy.text === undefined)).toBe(true)
  await observer.getByRole('button', { name: 'Copy sent payload', exact: true }).click()
  let copied = await application.evaluate(({ clipboard }) => clipboard.readText())
  expect(JSON.parse(copied)).toEqual({ image: 'x'.repeat(18000), caption: 'fixture' })
  await observer.getByRole('button', { name: 'Copy AI payload', exact: true }).click()
  expect(JSON.parse(await application.evaluate(({ clipboard }) => clipboard.readText()))).toEqual({ answers: [{ name: 'watch', choice: 'watch' }], usage: { input_tokens: 41 } })
  await observer.getByRole('button', { name: 'Close overlay', exact: true }).click()
  let visible = () => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().flatMap(window => window.contentView.children).some((view: any) => view.webContents?.getURL().endsWith('#plugin-overlay') && view.getVisible()))
  await expect.poll(visible).toBe(false)
  expect((await rpc('plugin.runs')).find((run: any) => run.id === id).status).toBe('running')
  await chrome.evaluate(id => (window as any).bmux.command({ method: 'plugin.overlay.show', args: { id } }), id)
  await expect.poll(visible).toBe(true)
  await observer.getByText('Details and settings', { exact: true }).click()
  let skipAds = observer.getByRole('checkbox', { name: 'Skip ads' })
  await expect(skipAds).not.toBeChecked()
  let checkboxBounds = await skipAds.boundingBox(), labelBounds = await observer.getByText('Skip ads', { exact: true }).boundingBox()
  expect(Math.abs(checkboxBounds!.y + checkboxBounds!.height / 2 - labelBounds!.y - labelBounds!.height / 2)).toBeLessThan(2)
  let before = (await state()).pluginOverlay.bounds
  await observer.getByRole('slider', { name: 'Resize page overlay' }).focus()
  await observer.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state()).pluginOverlay.bounds.width).toBe(before.width - 24)
  let resized = (await state()).pluginOverlay.bounds
  let left = observer.getByRole('slider', { name:'Resize page overlay from left', exact:true })
  await left.focus(); await observer.keyboard.press('ArrowRight')
  await expect.poll(async () => (await state()).pluginOverlay.bounds.width).toBe(resized.width - 24)
  expect((await state()).pluginOverlay.bounds.x).toBe(resized.x + 24)
  await expect(observer.getByText('◢', {exact:true})).toHaveCount(0)

  await observer.getByRole('button', { name: 'Collapse page overlay' }).click()
  await expect(observer.getByRole('button', { name: 'Expand page overlay' })).toBeVisible()
  await expect.poll(() => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().flatMap(window => window.contentView.children).find((view: any) => view.webContents?.getURL().endsWith('#plugin-overlay'))?.getBounds().height)).toBe(48)
  await observer.getByRole('button', { name: 'Expand page overlay' }).click()
  await expect(observer.getByRole('button', { name: 'Collapse page overlay' })).toBeVisible()
  await expect(observer.getByRole('status')).toBeVisible()
  await expect.poll(() => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().flatMap(window => window.contentView.children).find((view: any) => view.webContents?.getURL().endsWith('#plugin-overlay'))?.getBounds().height)).toBe(before.height)
  let captured = await capture()
  let pixel = await application.evaluate(({ BaseWindow, nativeImage }, { data, url }) => {
    let views = BaseWindow.getAllWindows().flatMap(window => window.contentView.children) as any[]
    let observer = views.find(view => view.webContents?.getURL().endsWith('#plugin-overlay')).getBounds()
    let page = views.find(view => view.webContents?.getURL().startsWith(url)).getBounds()
    let image = nativeImage.createFromBuffer(Buffer.from(data, 'base64')), size = image.getSize()
    let x = Math.floor((observer.x + observer.width / 2 - page.x) / page.width * size.width)
    let y = Math.floor((observer.y + observer.height / 2 - page.y) / page.height * size.height)
    let offset = (y * size.width + x) * 4
    return [...image.toBitmap().subarray(offset, offset + 3)]
  }, { data: captured, url })
  // This point is dark in the observer and white in the fixture page beneath it.
  expect(pixel).toHaveLength(3)
  expect(pixel.every(channel => channel > 240)).toBe(true)
  await observer.screenshot({ path: path.resolve('artifacts/plugin-overlay.png') })
  await observer.getByRole('button', { name: 'Start browsing', exact: true }).click()
  await expect(observer.getByRole('button', { name: 'Pause session', exact: true })).toBeVisible()
  await observer.screenshot({ path: path.resolve('artifacts/plugin-overlay-running.png') })
  await observer.getByRole('button', { name: 'Pause session', exact: true }).click()
  await expect(observer.getByRole('status')).toHaveText('Paused')
  await observer.getByRole('button', { name: 'Resume session', exact: true }).click()
  await expect(observer.getByRole('status')).toHaveText('Browsing')
  await observer.getByRole('button', { name: 'Finish fixture', exact: true }).click()
  await completed(id)
  await expect(observer.getByText('Session complete', { exact: true })).toBeVisible()
  await expect(observer.getByRole('button', { name: 'New session', exact: true })).toBeVisible()
  await observer.screenshot({ path: path.resolve('artifacts/plugin-overlay-complete.png') })
  await expect(observer.getByRole('button', { name: 'Expand page overlay', exact: true })).toBeVisible()
  await observer.getByRole('button', { name: 'Expand page overlay', exact: true }).click()
  await expect(observer.getByRole('button', { name: 'Choose session settings', exact: true })).toBeVisible()
  let page = application.context().pages().find(page => page.url().startsWith(url))!
  expect(await page.evaluate(() => typeof (window as any).bmux)).toBe('undefined')
})

test('Social Media details launch one settings form and a muted window with the active profile', async () => {
  let before = await state(), client = before.model.clients.find((client: any) => client.id === before.clientId)
  let profile = (await rpc('profile.create', { name: 'Feed launch fixture' })).id
  let source = await rpc('new-window', { session: client.sessionId, client: client.id, profile, url, agentId: 'source-cli-agent' })
  await rpc('wait', { pane: source.panes[0].id, selector: '#username' }); await activate()
  let windows = (await state()).model.sessions.find((session: any) => session.id === client.sessionId).windows.length
  await chrome.getByRole('button', { name: 'Command prompt' }).click()
  let command = chrome.getByRole('combobox', { name: 'Command', exact: true }); await command.fill('extensions'); await command.press('Enter')
  let panel = chrome.getByRole('dialog', { name: 'Extensions', exact: true })
  await expect(panel.getByRole('heading', { name: 'Social Media', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Fixture plugin', exact: true }).click()
  let details = panel.getByRole('region', { name: 'Plugin details' })
  await expect(details.getByText('Feed browsing and all platform tools.')).toBeVisible()
  let tabs = details.getByRole('tablist', { name: 'Plugin features' })
  await expect(tabs.getByRole('tab')).toHaveText(['Actions', 'Browsing', 'Publishing', 'Settings', 'Activity'])
  await expect(details.getByRole('button', { name: 'password', exact: true })).toHaveCount(0)
  await tabs.getByRole('tab', { name: 'Publishing', exact: true }).click()
  let password = details.getByRole('button', { name: 'password', exact: true })
  await expect(password).toBeVisible()
  expect(await password.evaluate(element => getComputedStyle(element).fontSize)).toBe('12px')
  expect(await password.evaluate(element => getComputedStyle(element).borderTopStyle)).toBe('none')
  await password.focus(); await password.press('Tab')
  await expect(tabs.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(details.getByRole('checkbox', { name: 'Fixture plugin · enabled', exact: true })).toBeVisible()
  await expect(password).toHaveCount(0)
  await tabs.getByRole('tab', { name: 'Activity', exact: true }).click()
  await expect(details.getByText('Plugin runs', { exact: true })).toBeVisible()
  await tabs.getByRole('tab', { name: 'Browsing', exact: true }).click()
  await expect(details.getByRole('button', { name: 'Simulate feed browsing', exact: true })).toBeVisible()
  expect((await state()).model.sessions.find((session: any) => session.id === client.sessionId).windows.length).toBe(windows)
  let bounds = await panel.boundingBox(), viewport = await chrome.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(bounds!.width).toBeGreaterThan(Math.min(1400, viewport.width * .9))
  expect(bounds!.height).toBeGreaterThan(viewport.height * .85)
  await fs.mkdir(path.resolve('artifacts'), { recursive: true }); await chrome.screenshot({ path: path.resolve('artifacts/plugin-feature-tabs.png') })
  let nativeBounds = await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find(window => window.isVisible())!.getBounds())
  await application.evaluate(({ BaseWindow }, bounds) => BaseWindow.getAllWindows().find(window => window.isVisible())!.setBounds({ ...bounds, width: 760 }), nativeBounds)
  await expect.poll(() => chrome.evaluate(() => innerWidth)).toBeLessThan(899)
  await expect(panel.getByRole('region', { name: 'Plugin list', exact: true })).toBeHidden()
  let actionBounds = await details.getByRole('button', { name: 'Simulate feed browsing', exact: true }).boundingBox(), detailBounds = await details.boundingBox()
  expect(actionBounds!.x).toBeGreaterThanOrEqual(detailBounds!.x)
  expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(detailBounds!.x + detailBounds!.width)
  let description = details.locator('[id$="-description"]')
  await expect(description).toHaveCount(1)
  expect(await description.evaluate(element => element.scrollWidth <= element.clientWidth && getComputedStyle(element).whiteSpace === 'normal')).toBe(true)
  expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await chrome.screenshot({ path: path.resolve('artifacts/plugin-feature-tabs-narrow.png') })
  await application.evaluate(({ BaseWindow }, bounds) => BaseWindow.getAllWindows().find(window => window.isVisible())!.setBounds(bounds), nativeBounds)
  await expect.poll(() => chrome.evaluate(() => innerWidth)).toBe(viewport.width)
  await tabs.getByRole('tab', { name: 'Browsing', exact: true }).press('ArrowRight')
  await expect(tabs.getByRole('tab', { name: 'Publishing', exact: true })).toHaveAttribute('aria-selected', 'true')
  await tabs.getByRole('tab', { name: 'Publishing', exact: true }).press('Home')
  await expect(tabs.getByRole('tab', { name: 'Actions', exact: true })).toHaveAttribute('aria-selected', 'true')
  await tabs.getByRole('tab', { name: 'Browsing', exact: true }).click()
  await details.getByRole('button', { name: 'Simulate feed browsing', exact: true }).click()
  let dialog = chrome.getByRole('dialog', { name: 'Plugin', exact: true })
  await expect(dialog.getByRole('heading', { name: 'Fixture plugin · Simulate feed browsing' })).toBeVisible()
  await expect(dialog.getByText('Opens a new muted window using Feed launch fixture.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Saved settings', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByLabel('Duration in seconds')).toHaveValue('300')
  await expect(dialog.getByLabel('AI source')).toHaveValue('personal')
  await expect(dialog.getByLabel('AI source').getByRole('option', { name: 'Personal OpenAI API key', exact: true })).toHaveCount(1)
  await expect(dialog.getByRole('button', { name: 'Edit settings', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Skip ads')).toBeEnabled()
  await dialog.getByRole('button', { name: 'Caption training', exact: true }).click()
  await expect(dialog.getByLabel('Duration in seconds')).toHaveValue('60')
  await chrome.screenshot({ path: path.resolve('artifacts/social-plugin-presets.png') })
  await dialog.getByLabel('Skip ads').selectOption('false')
  await expect(dialog.getByLabel('Skip ads')).toHaveValue('false')
  await expect(dialog.getByText('Changes save automatically for this profile and platform.', { exact: true })).toBeVisible()
  await dialog.getByLabel('Skip ads').selectOption('true')
  await expect(dialog.getByLabel('AI source')).toHaveValue('personal')
  await expect(dialog.getByLabel('AI source').getByRole('option', { name: 'Personal OpenAI API key', exact: true })).toHaveCount(1)
  await expect(dialog.getByLabel('AI source').getByRole('option', { name: 'BMUX subscription', exact: true })).toHaveCount(1)
  await expect(dialog.getByRole('group', { name: 'Playback', exact: true })).toBeVisible()
  await expect(dialog.getByRole('group', { name: 'AI and observation', exact: true })).toBeVisible()
  await expect(dialog.getByRole('group', { name: 'Interactions', exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Skip ads')).toHaveValue('true')
  await expect(dialog.getByRole('option').filter({hasText:'Use saved setting:'})).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Saved settings', exact: true }).click()
  await expect(dialog.getByLabel('Skip ads')).toHaveValue('true')
  await expect(dialog.getByLabel('Duration in seconds')).toHaveValue('60')
  await expect(dialog.getByLabel('Session ID')).toHaveCount(0)
  await dialog.getByLabel('Persona').fill('tonisdev\nIndie hacking, AI and computers')
  await dialog.getByLabel('AI source').selectOption('included')
  await expect(dialog.getByRole('button', { name: 'Done editing', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Skip ads')).toBeEnabled()
  await expect(dialog.getByLabel('AI source')).toHaveValue('included')
  await fs.mkdir(path.resolve('artifacts'), { recursive: true }); await chrome.screenshot({ path: path.resolve('artifacts/social-plugin-settings.png') })
  await application.evaluate(({ BaseWindow }, bounds) => BaseWindow.getAllWindows().find(window => window.isVisible())!.setBounds({ ...bounds, width: 640, height: 500 }), nativeBounds)
  await expect.poll(() => chrome.evaluate(() => innerWidth)).toBeLessThan(641)
  let startBounds = await dialog.getByRole('button', { name: 'Start browsing', exact: true }).boundingBox(), shortViewport = await chrome.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(startBounds!.y + startBounds!.height).toBeLessThan(shortViewport.height)
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await chrome.screenshot({ path: path.resolve('artifacts/social-plugin-settings-short.png') })
  await application.evaluate(({ BaseWindow }, bounds) => BaseWindow.getAllWindows().find(window => window.isVisible())!.setBounds(bounds), nativeBounds)
  await expect.poll(() => chrome.evaluate(() => innerWidth)).toBe(viewport.width)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect((await state()).model.sessions.find((session: any) => session.id === client.sessionId).windows.length).toBe(windows)
  let id = await run('launch')
  await expect(dialog.getByLabel('Persona')).toHaveValue('tonisdev\nIndie hacking, AI and computers')
  await expect(dialog.getByLabel('AI source')).toHaveValue('included')
  await expect(dialog.getByLabel('Skip ads')).toHaveValue('true')
  await dialog.getByRole('button', { name: 'Quick browsing', exact: true }).click()
  await dialog.getByLabel('Duration in seconds').fill('5')
  await dialog.getByRole('button', { name: 'Start browsing', exact: true }).click()
  await completed(id)
  let current = await state(), selected = current.model.clients.find((client: any) => client.id === current.clientId)
  let session = current.model.sessions.find((session: any) => session.id === selected.sessionId), window = session.windows.find((window: any) => window.id === selected.windowId)
  expect(session.windows.length).toBe(windows + 1)
  expect(window.id).not.toBe(source.id)
  expect(window.panes[0].profileId).toBe(profile)
  expect(session.windows.find((window: any) => window.id === source.id).panes[0].url).toBe(url + '/')
  expect((await rpc('plugin.runs')).find((run: any) => run.id === id).result).toEqual({ pane: window.panes[0].id, profile, approved: true, url: url + '/feed', parameters: expect.objectContaining({ seconds: '5', ads: false,persona:'tonisdev\nIndie hacking, AI and computers' }) })
  expect(await application.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url + '/feed' && contents.isAudioMuted()), url)).toBe(true)
  await expect(dialog).toHaveCount(0)
  await expect(chrome.getByRole('textbox', { name: 'URL or search' })).toHaveCount(0)
})

test('Social Media Stop returns to configuration without Prepare or a new window', async () => {
  let id = await run('launch', { parameters: { session: 'observe' } })
  let dialog = chrome.getByRole('dialog', { name: 'Plugin', exact: true })
  await expect(dialog.getByRole('button', { name: 'Start browsing', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Start browsing', exact: true }).click()
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('#plugin-overlay'))).toBe(true)
  let observer = application.context().pages().find(page => page.url().endsWith('#plugin-overlay'))!
  await expect(observer.getByRole('status')).toHaveText('Browsing')
  let windows = (await state()).model.sessions.flatMap((session: any) => session.windows).length
  await expect(observer.locator('details')).toHaveCount(1)
  await observer.getByText('Details and settings', { exact: true }).click()
  await observer.getByLabel('Page overlay detail').selectOption({ label: 'Full answer' })
  await expect(observer.locator('pre')).toHaveText('Watch')
  await observer.getByRole('button', { name: 'Stop session', exact: true }).click()
  await completed(id)
  await expect(dialog.getByRole('heading', { name: 'Fixture plugin · Simulate feed browsing' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Saved settings', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('button', { name: 'Start browsing', exact: true })).toBeVisible()
  expect((await state()).model.sessions.flatMap((session: any) => session.windows).length).toBe(windows)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})
