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
let openSettings = async (dialog: ReturnType<Page['getByRole']>) => { for (let section of await dialog.locator('details').all()) if (await section.getAttribute('open') === null) await section.locator('summary').click() }
let startBrowsing = async (dialog: ReturnType<Page['getByRole']>, destination = 'New window') => {
  await dialog.getByRole('button', { name: 'Start browsing', exact: true }).click()
  await dialog.getByRole('button', { name: destination, exact: true }).click()
}
let state = () => chrome.evaluate(() => (window as any).bmux.state())
let activate = async () => { let current = await state(); await expect.poll(async () => { await rpc('activate-client', { client: current.clientId }); return (await state()).focusedClientId }).toBe(current.clientId) }
let run = async (action: string, args: Record<string, unknown> = {}) => (await rpc('plugin.run', { action: `test/${action}`, ...args })).id as string
let completed = async (id: string, status = 'completed', timeout = 5000) => { await expect.poll(async () => (await rpc('plugin.runs')).find((run: any) => run.id === id)?.status, { timeout }).toBe(status) }
let overlayForRun = async (id: string) => {
  let observer: Page | undefined
  await expect.poll(async () => {
    for (let page of application.context().pages().filter(page => page.url().endsWith('#plugin-overlay'))) {
      let overlay = await page.evaluate(() => (window as any).bmux?.overlayState()).catch(() => undefined)
      if (overlay?.runId === id) { observer = page; return true }
    }
    return false
  }).toBe(true)
  return observer!
}
let pluginViews = () => application.evaluate(async ({ BaseWindow }) => {
  let result: { id: number; bounds: { x: number; y: number; width: number; height: number }; zoom: number }[] = []
  for (let window of BaseWindow.getAllWindows()) for (let view of window.contentView.children as any[]) {
    if (!view.webContents?.getURL().endsWith('#plugin-overlay') || !view.getVisible()) continue
    let overlay = await view.webContents.executeJavaScript('window.bmux.overlayState()')
    if (overlay?.tabs.some((tab: any) => !['agent','viewport'].includes(tab.id))) result.push({ id: view.webContents.id, bounds: view.getBounds(), zoom: view.webContents.getZoomFactor() })
  }
  return result
})
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
} else if (['overlay','graph','startup'].includes(action)) {
 let content={copies:[{id:'request-one',label:'Copy sent payload',text:JSON.stringify({image:'x'.repeat(18000),caption:'fixture'})},{id:'response-one',label:'Copy AI payload',text:JSON.stringify({answers:[{name:'watch',choice:'watch'}],usage:{input_tokens:41}})}],title:'Feed training',subtitle:'Fixture profile',status:'Waiting for Start',nodes:[{title:'Post',lines:['A software demo'],tone:'cyan'},{title:'AI answer',lines:['Useful demonstration','Exact duration confidence: 72% (duration assessment)','Profile match: 98%','Watching: 30s remaining'],tone:'neutral'}],controls:[{id:'fail',label:'Trigger AI error',kind:'button'},{id:'start',label:'Start browsing',kind:'button'},{id:'ads',label:'Skip ads',kind:'toggle',value:false},{id:'settings',label:'AI limit settings',kind:'button',setting:'ads'}],details:[{title:'Profile',text:'Interested in computers'}]};if(['graph','startup'].includes(action)){content.nodes.push({title:'Interactions',lines:['1 like · 2 comment reads · 1 profile view'],tone:'neutral'});content.decision={loading:true,options:[{id:'skip',label:'Skip',active:false},{id:'watch',label:'Brief watch',active:false},{id:'finish',label:'Near the end',active:false}]};content.controls.push({id:'decide',label:'Resolve AI decision',kind:'button'})}if(action==='startup'){content.nodes[0].lines=['No post yet'];content.subtitle='Default · bluesky · Confirm actions';content.controls=[{id:'continue',label:'Start browsing',kind:'button'},{id:'seconds',label:'Duration in seconds',kind:'text',value:'120'},{id:'approval',label:'Action approval',kind:'choice',choices:['Auto continue','Confirm actions'],value:'Confirm actions'}]}host('overlay.update',content);
 while(true){
  let inputs=host('overlay.events');
  if(inputs.some(input=>input.id==='decide')){content={...content,decision:{loading:false,options:[{id:'skip',label:'Skip',probability:.05,active:false},{id:'watch',label:'Brief watch',probability:.8,active:true},{id:'finish',label:'Near the end',probability:.15,active:false}]}};host('overlay.update',content)}
  if(inputs.some(input=>input.id==='next')){content={...content,status:'Showing next post'};host('overlay.update',content)}
  if(inputs.some(input=>input.id==='finish')){host('overlay.update',{...content,status:'Session complete'});host('result',{started:true});break}
  if(inputs.some(input=>input.id==='fail')){content={...content,error:{title:'BMUX rejected the AI query',message:'Use up to eight bounded questions. No OpenAI request was sent.',diagnostic:'Stage: request · HTTP 400 · req-fixture',controls:['resume','settings','finish']},controls:[{id:'resume',label:'Resume session',kind:'button'},{id:'finish',label:'Finish fixture',kind:'button'},{id:'ads',label:'Skip ads',kind:'toggle',value:false},{id:'settings',label:'AI settings',kind:'button',setting:'ads'}]};host('overlay.update',content)}
  for(let input of inputs)if(['start','continue','auto','pause','resume'].includes(input.id)){
   delete content.error;
   let paused=input.id==='pause';content={...content,status:paused?'Paused':'Browsing',controls:[{id:paused?'resume':'pause',label:paused?'Resume session':'Pause session',kind:'button'},{id:'finish',label:'Finish fixture',kind:'button'},{id:'next',label:'Show next post',kind:'button'}]};host('overlay.update',content)
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
  let second = path.join(directory, 'plugins/second'); await fs.mkdir(second, { recursive: true })
  await fs.writeFile(path.join(second, 'run.mjs'), script.replace("title:'Feed training'", "title:'Research notes',icon:'search'"))
  await fs.writeFile(path.join(second, 'plugin.yaml'), stringify({ schema_version: 1, id: 'second', name: 'Second plugin', version: '1', actions: [{ id: 'overlay', title: 'Research notes', command: ['node', './run.mjs', 'overlay'], capabilities: ['ui'], timeout_seconds: 60 }] }))
  await fs.writeFile(path.join(folder, 'settings.mjs'), `import fs from 'node:fs';
let file='settings-'+encodeURIComponent(process.env.BMUX_PLUGIN_PROFILE_ID)+'.json';
let values={seconds:'300',ads:false,preset:'observed-fast',review:'auto',ai:true,ai_source:'personal',train:false,visual:true,interactive:false,allow_like:false,persona:'Interested in software'};
if(fs.existsSync(file))Object.assign(values,JSON.parse(fs.readFileSync(file,'utf8')));
if(process.argv[2]==='save'){let input='';for await(const chunk of process.stdin)input+=chunk;Object.assign(values,JSON.parse(input));fs.writeFileSync(file,JSON.stringify(values))}
console.log(JSON.stringify(values));`)

  let action = (id: string) => ({ id, title: id, command: ['node', './run.mjs', id], capabilities: ['browser.read', 'browser.write', 'ui'], timeout_seconds: 40 })
  await fs.writeFile(path.join(folder, 'plugin.yaml'), stringify({ schema_version: 1, id: 'test', name: 'Fixture plugin', category: 'Social Media', description: 'Feed browsing and all platform tools.', version: '1', actions: ['pick', 'stale', 'slow', 'wait', 'hidden', 'title', 'capture', 'overlay', 'graph', 'startup'].map(action).concat([{ ...action('launch'), group: 'Browsing', title: 'Simulate feed browsing', description: 'Browse in a new muted window using the active profile. Choose a preset, then adjust settings before starting. This longer description must wrap within its column at every window size.', configuration_command: ['node', './settings.mjs'], configuration_save_command: ['node', './settings.mjs', 'save'], presets: [{ id: 'quick', title: 'Quick browsing', description: 'Five minutes with no interactions.', values: { seconds: '300', ads: false } }, { id: 'training', title: 'Caption training', values: { seconds: '60', ads: true } }], capabilities: ['browser.manage', 'browser.read', 'browser.write', 'ui'], launch_url: 'https://example.test/feed', parameters: [{name:'watch_range',title:'Brief watch time',kind:'text',range:{min:1,max:120,step:1,unit:'s'},default:'8-12',section:'Playback'}, {name:'persona',title:'Persona',kind:'text',multiline:true,section:'Persona'}, { name: 'seconds', title: 'Duration in seconds', kind: 'text', section: 'Session' }, { name: 'ads', title: 'Skip ads', kind: 'boolean', section: 'Interactions', advanced: true }, { name: 'review', title: 'Action approval', kind: 'choice', choices: ['auto', 'confirm'], section: 'Session' }, { name: 'preset', title: 'Browsing pace', kind: 'choice', choices: ['observed-fast', 'observed-balanced', 'remote'], section: 'Playback', advanced: true }, { name: 'ai_source', title: 'AI source', kind: 'choice', choices: ['included', 'personal'], section: 'AI and observation', advanced: true, description: 'BMUX subscription uses your included monthly allowance. A personal OpenAI API key is billed separately by OpenAI.' }, ...[{ name: 'ai', title: 'Visual AI decisions' }, { name: 'train', title: 'Caption training' }, { name: 'visual', title: 'Page overlay' }].map(field => ({ ...field, kind: 'boolean', section: 'AI and observation', advanced: true })), ...[{ name: 'interactive', title: 'Browse comments and profiles' }, { name: 'allow_like', title: 'Allow one like this session' }].map(field => ({ ...field, kind: 'boolean', section: 'Interactions', advanced: true })), { name: 'session', title: 'Session ID', kind: 'text', hidden: true }] } as any, { ...action('password'), group: 'Publishing', parameters: [{ name: 'password', title: 'Fixture password', kind: 'password', required: true }] } as any]), hooks: [{ ...action('ready'), event: 'page-ready', matches: ['http://127.0.0.1:*/*'] }, { ...action('changed'), event: 'url-change', matches: ['http://127.0.0.1:*/*'] }] }))
  await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ automation: { agents: { requireId: true, requireType: true, definitions: { tmux: { fields: { paneId: { label: 'Terminal pane', required: true } } } } } }, browser: { autoUpdateFilters: false }, keyboard: { shortcuts: { 'Cmd+Shift+L': 'plugin:test/pick' } }, plugins: { second: { enabled: true }, test: { enabled: true, hooks: true }, 'local.page-tools': { enabled: true } } }))
  server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Plugin fixture</title><h1>Plugin fixture</h1><input id="username" autocomplete="username"><input id="password" type="password"><input id="hidden" type="hidden"><p id="note">Native page content</p>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${(server.address() as any).port}`
  let manifest = parse(await fs.readFile(path.join(folder, 'plugin.yaml'), 'utf8'))
  manifest.actions.find((action: any) => action.id === 'launch').launch_url = url + '/feed'
  let launch = manifest.actions.find((action: any) => action.id === 'launch')
  manifest.actions.push({ ...launch, group: undefined, id: 'profiles', title: 'Browse feed', configuration_command: ['node','./profiles.mjs'], configuration_save_command: ['node','./profiles.mjs','save'], configuration_profile_command: ['node','./profiles.mjs','profile'] })
  await fs.writeFile(path.join(folder, 'profiles.mjs'), `import fs from 'node:fs';
let file='profiles-'+encodeURIComponent(process.env.BMUX_PLUGIN_PROFILE_ID)+'.json';
let library=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{active:'default',items:[{id:'default',name:'Default',values:{seconds:'300',persona:'Software',ads:false}}]};
let item=()=>library.items.find(item=>item.id===library.active);
if(['save','profile'].includes(process.argv[2])){let text='';for await(let chunk of process.stdin)text+=chunk;let input=JSON.parse(text);
if(process.argv[2]==='save')Object.assign(item().values,input);else if(input.action==='create'){let created={id:'profile-'+library.items.length,name:input.name,values:{...item().values,...(input.template?{persona:'AI research'}:{})}};library.items.push(created);library.active=created.id}else if(input.action==='select')library.active=input.id;else if(input.action==='rename')item().name=input.name;else if(input.action==='delete'){library.items=library.items.filter(item=>item.id!==input.id);library.active=library.items[0].id}
fs.writeFileSync(file,JSON.stringify(library))}
console.log(JSON.stringify({summary:['Daily likes: 8/20 used · 12 remaining','Weekly follows: 3/10 used · 7 remaining'],values:item().values,profiles:{active:library.active,items:library.items.map(({id,name})=>({id,name})),templates:[{id:'research',name:'AI Researcher'}]}}));`)
  await fs.writeFile(path.join(folder, 'plugin.yaml'), stringify(manifest))
  application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_DEBUG: '1' } })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await chrome.waitForLoadState('domcontentloaded')
  await application.evaluate(({ ipcMain }) => {
    ;(globalThis as any).__pluginAIUsage = { enabled: true, active: true, remaining: 219, used: 81, limit: 300 }
    ipcMain.removeHandler('remote-account')
    ipcMain.handle('remote-account', (_event, endpoint) => {
      if (endpoint === '/api/ai/usage') return (globalThis as any).__pluginAIUsage
      if (endpoint === '/api/billing/status') return { enabled: true, relay: { active: false, status: 'inactive' } }
      throw new Error('Sign in to remote')
    })
  })
  await observeNativeFocus(application)
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
        let post = document.createElement('div')
        post.style.cssText = 'position:fixed;left:20px;top:30px;width:160px;height:100px;background:rgb(255,36,0);z-index:2147483647'
        document.body.append(post)
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
        await expect.poll(async () => {
          let current = await windows()
          return hidden ? current.every(window => !window.visible && !window.focused) : current.some(window => window.visible && window.focused)
        }).toBe(true)
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
        let clipped = await rpc('screenshot', { pane: pane.id, fullPage: false, encoding: 'base64', format: 'png', clip: { x: 20, y: 30, width: 160, height: 100 }, viewport: [beforePage.width, beforePage.height] })
        let post = await application.evaluate(({ nativeImage }, data) => {
          let image = nativeImage.createFromBuffer(Buffer.from(data, 'base64')), pixels = image.toBitmap()
          let size = image.getSize(), center = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4
          return { size, center: [...pixels.subarray(center, center + 3)].sort((a, b) => a - b) }
        }, clipped.data)
        expect(post.size.width).toBe(Math.round(180 * size.width / beforePage.width) - Math.round(20 * size.width / beforePage.width))
        expect(post.size.height).toBe(Math.round(130 * size.height / beforePage.height) - Math.round(30 * size.height / beforePage.height))
        expect(post.center, JSON.stringify({ mobile, hidden, size, beforePage })).toEqual([0, 36, 255])
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

test('plugin overlay sits above the page, zooms, collapses and receives controls', async () => {
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0]
  let capture = async () => { let id = await run('capture', { pane: pane.id }); await completed(id); return (await rpc('plugin.runs')).find((run: any) => run.id === id).result.data }
  let id = await run('overlay', { pane: pane.id })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('#plugin-overlay'))).toBe(true)
  let observer = await overlayForRun(id)
  await expect(observer.getByRole('tabpanel', { name: 'Page overlay', exact: true })).toBeVisible()
  await expect(observer.getByRole('status')).toHaveText('Waiting for Start')
  await expect(observer.getByRole('button', { name: 'Start browsing', exact: true })).toBeVisible()
  expect((await state()).pluginOverlay.content.copies.every((copy: any) => copy.text === undefined)).toBe(true)
  await observer.getByRole('button', { name: 'Copy sent payload', exact: true }).click()
  let copied = await application.evaluate(({ clipboard }) => clipboard.readText())
  expect(JSON.parse(copied)).toEqual({ image: 'x'.repeat(18000), caption: 'fixture' })
  await observer.getByRole('button', { name: 'Copy AI payload', exact: true }).click()
  expect(JSON.parse(await application.evaluate(({ clipboard }) => clipboard.readText()))).toEqual({ answers: [{ name: 'watch', choice: 'watch' }], usage: { input_tokens: 41 } })
  await expect(observer.getByRole('button', { name: /^Close .+ tab$/ })).toHaveCount(1)
  await observer.getByRole('button', { name: 'Minimize page overlay', exact: true }).click()
  await expect.poll(async () => (await state()).pluginOverlay.bounds.collapsed).toBe(true)
  expect((await rpc('plugin.runs')).find((run: any) => run.id === id).status).toBe('running')
  await chrome.evaluate(id => (window as any).bmux.command({ method: 'plugin.overlay.show', args: { id } }), id)
  await expect(observer.getByRole('button', { name: 'Minimize page overlay' })).toBeVisible()
  await observer.getByRole('button', { name: 'AI limit settings', exact: true }).click()
  await expect(observer.getByRole('checkbox', { name: 'Skip ads' })).toBeFocused()
  await observer.getByLabel('Page overlay detail').selectOption({ label: 'Profile' })
  await observer.getByRole('button', { name: 'AI limit settings', exact: true }).click()
  await expect(observer.getByRole('checkbox', { name: 'Skip ads' })).toBeFocused()
  let skipAds = observer.getByRole('checkbox', { name: 'Skip ads' })
  await expect(skipAds).not.toBeChecked()
  let checkboxBounds = await skipAds.boundingBox(), labelBounds = await observer.getByText('Skip ads', { exact: true }).boundingBox()
  expect(Math.abs(checkboxBounds!.y + checkboxBounds!.height / 2 - labelBounds!.y - labelBounds!.height / 2)).toBeLessThan(2)
  let before = (await state()).pluginOverlay.bounds
  await observer.getByRole('slider', { name: 'Panel zoom top-right', exact: true }).focus()
  await observer.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state()).pluginOverlay.zoom).toBe(.95)
  let corner = observer.getByRole('slider', { name: 'Panel zoom top-right', exact: true })
  await corner.focus(); await observer.keyboard.press('ArrowRight')
  await expect.poll(async () => (await state()).pluginOverlay.zoom).toBe(1)
  expect((await state()).pluginOverlay.bounds.width).toBe(before.width)
  await observer.getByRole('button', { name: 'Minimize page overlay' }).click()
  await expect(observer.getByRole('tab').first()).toBeVisible()
  await expect.poll(() => observer.evaluate(() => innerHeight)).toBe(32)
  await observer.getByRole('tab').first().click()
  await expect(observer.getByRole('button', { name: 'Minimize page overlay' })).toBeVisible()
  await expect(observer.getByRole('status')).toBeVisible()
  await expect.poll(() => observer.evaluate(() => innerHeight)).toBe(before.height)
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
  await observer.getByRole('button', { name: 'Minimize page overlay', exact: true }).click()
  await expect(observer.getByRole('heading', { name: 'Post', exact: true })).toHaveCount(0)
  await expect.poll(() => observer.evaluate(() => innerHeight)).toBe(32)
  await observer.screenshot({ path: path.resolve('artifacts/plugin-overlay-tabs.png') })
  await observer.getByRole('tab').first().click()
  await observer.getByRole('button', { name: 'Pause session', exact: true }).click()
  await expect(observer.getByRole('status')).toHaveText('Paused')
  await observer.getByRole('button', { name: 'Resume session', exact: true }).click()
  await expect(observer.getByRole('heading', { name: 'Post', exact: true })).toBeVisible()
  await observer.getByRole('button', { name: 'Finish fixture', exact: true }).click()
  await completed(id)
  await expect(observer.getByRole('tab').first()).toBeVisible()
  await observer.screenshot({ path: path.resolve('artifacts/plugin-overlay-complete.png') })
  await expect(observer.getByRole('tab').first()).toBeVisible()
  await observer.getByRole('tab').first().click()
  await expect(observer.getByRole('button', { name: 'Choose session settings', exact: true })).toBeVisible()
  let page = application.context().pages().find(page => page.url().startsWith(url))!
  expect(await page.evaluate(() => typeof (window as any).bmux)).toBe('undefined')
})

test('plugin overlays remain on visible panes and detach when switching windows', async () => {
  let current = await state(), client = current.model.clients.find((item: any) => item.id === current.clientId)
  let original = client.paneId
  await rpc('select-pane', { client: client.id, pane: original })
  let id = await run('overlay', { tab: original })
  let attached = async () => (await pluginViews()).length
  await expect.poll(attached).toBe(1)
  let observer = await overlayForRun(id)
  await expect(observer.getByRole('button', { name: 'Start browsing', exact: true })).toBeVisible()
  await observer.getByRole('button', { name: 'Start browsing', exact: true }).click()
  await expect(observer.getByRole('status')).toHaveText('Browsing')
  let other = await rpc('split-window', { client: client.id, pane: original, url: url + '/other-pane' })
  await rpc('wait', { pane: other.id, selector: '#username' })
  let otherWindow = await rpc('new-window', { client: client.id, session: client.sessionId, url: url + '/other-window' })
  await rpc('wait', { pane: otherWindow.panes[0].id, selector: '#username' })
  for (let ended of [false, true]) {
    await rpc('select-pane', { client: client.id, pane: other.id })
    await expect.poll(attached).toBe(1)
    await expect.poll(async () => (await state()).pluginOverlay).toBeUndefined()
    await rpc('select-window', { client: client.id, window: otherWindow.id })
    await expect.poll(attached).toBe(0)
    await expect.poll(async () => (await state()).pluginOverlay).toBeUndefined()
    await rpc('select-pane', { client: client.id, pane: original })
    await expect.poll(attached).toBe(1)
    await expect.poll(async () => (await state()).pluginOverlay?.runId).toBe(id)
    if (ended) { await observer.getByRole('tab', { name: 'Feed training', exact: true }).click(); await expect(observer.getByRole('status')).toHaveText('Session complete') }
    else await expect(observer.getByRole('status')).toHaveText('Browsing')
    if (!ended) {
      await observer.getByRole('button', { name: 'Finish fixture', exact: true }).click()
      await completed(id)
    }
  }
  await rpc('kill-pane', { pane: other.id, confirm: true })
  await rpc('kill-window', { window: otherWindow.id, confirm: true })
})

test('completed plugin overlays disappear when opening a different page in the same pane', async () => {
  let current = await state(), client = current.model.clients.find((item: any) => item.id === current.clientId)
  let pane = client.paneId
  let id = await run('overlay', { tab: pane })
  let attached = async () => (await pluginViews()).length
  await expect.poll(attached).toBe(1)
  let observer = await overlayForRun(id)
  await expect(observer.getByRole('button', { name: 'Start browsing', exact: true })).toBeVisible()
  await observer.getByRole('button', { name: 'Start browsing', exact: true }).click()
  await rpc('navigate', { pane, url: url + '/active-overlay' })
  await rpc('wait', { pane, selector: '#username' })
  await expect.poll(async () => (await state()).pluginOverlay?.runId).toBe(id)
  await expect.poll(attached).toBe(1)
  await observer.getByRole('button', { name: 'Finish fixture', exact: true }).click()
  await completed(id)
  await expect(observer.getByRole('tab', { name: 'Feed training', exact: true })).toHaveAttribute('aria-selected', 'false')
  await rpc('navigate', { pane, url: url + '/after-overlay' })
  await rpc('wait', { pane, selector: '#username' })
  await expect.poll(async () => (await state()).pluginOverlay).toBeUndefined()
  await expect.poll(attached).toBe(0)
  await rpc('back', { pane })
  await rpc('wait', { pane, selector: '#username' })
  await expect.poll(async () => (await state()).pluginOverlay).toBeUndefined()
  await expect.poll(attached).toBe(0)
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
  let shared = panel.getByRole('button', { name: 'Settings', exact: true }), platform = panel.getByRole('button', { name: 'Fixture plugin', exact: true })
  await expect(shared).toBeVisible()
  expect(await shared.evaluate((element, other) => !!(element.compareDocumentPosition(other as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await platform.elementHandle())).toBe(true)
  await platform.click()
  let details = panel.getByRole('region', { name: 'Plugin details' })
  await expect(details.getByText('Feed browsing and all platform tools.')).toBeVisible()
  let tabs = details.getByRole('tablist', { name: 'Plugin features' })
  await expect(tabs.getByRole('tab')).toHaveText(['Actions', 'Browsing', 'Publishing', 'Settings', 'Activity', 'Hooks', 'Recordings'])
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
  await tabs.getByRole('tab', { name: 'Hooks', exact: true }).click()
  let hooks = details.getByRole('region', { name: 'Social post hooks' })
  await expect(hooks.getByLabel('Endpoint URL')).toBeVisible()
  await hooks.getByLabel('Endpoint URL').fill('https://receiver.example/posts')
  await hooks.getByRole('button', { name: 'Save hook', exact: true }).click()
  await expect(hooks.getByRole('status')).toHaveText('Hook saved')
  await expect(hooks.getByText('0 sent · 0 pending · 0 failed')).toBeVisible()
  await tabs.getByRole('tab', { name: 'Recordings', exact: true }).click()
  await expect(details.getByRole('tabpanel', { name: 'Recordings', exact: true }).getByRole('region', { name: 'Recordings', exact: true })).toBeVisible()
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
  await expect(dialog.getByRole('region', { name: 'Plugin list', exact: true })).toBeVisible()
  await expect(dialog.getByRole('group', { name: 'Session', exact: true })).toHaveAttribute('open')
  for (let section of ['Playback', 'Interactions']) await expect(dialog.getByRole('group', { name: section, exact: true })).not.toHaveAttribute('open')
  await expect(dialog.locator(':scope > header').getByRole('button', { name: 'Back to Fixture plugin', exact: true })).toBeVisible()
  let subscription = dialog.getByRole('region', { name: 'AI subscription', exact: true })
  await expect(subscription.getByLabel('AI source')).toBeVisible()
  await expect(subscription.getByRole('button', { name: 'Manage subscription', exact: true })).toBeVisible()
  expect(await subscription.evaluate(element => { let settings = document.querySelector('[aria-label="Browsing presets"]')!; return !!(element.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING) })).toBe(true)
  await expect(dialog.locator('[data-plugin-setting="ai_source"]')).toHaveAttribute('title', /included monthly allowance/)
  await expect(dialog.locator('[data-plugin-setting] small')).toHaveCount(0)
  await expect(dialog.getByText('Profile: Feed launch fixture', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Saved settings', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('group', { name: 'Persona', exact: true })).not.toHaveAttribute('open')
  await chrome.screenshot({ path: path.resolve('artifacts/plugin-settings-collapsed.png') })
  await openSettings(dialog)
  await expect(dialog.getByLabel('Duration in seconds')).toHaveValue('300')
  await expect(dialog.getByLabel('AI source')).toHaveValue('personal')
  await expect(dialog.getByLabel('AI source').getByRole('option', { name: 'Personal OpenAI API key', exact: true })).toHaveCount(1)
  await expect(dialog.getByRole('button', { name: 'Edit settings', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Skip ads')).toBeEnabled()
  await dialog.getByLabel('Browsing preset', { exact: true }).selectOption('training')
  await expect(dialog.getByLabel('Duration in seconds')).toHaveValue('60')
  await chrome.screenshot({ path: path.resolve('artifacts/social-plugin-presets.png') })
  await dialog.getByLabel('Skip ads').selectOption('false')
  await expect(dialog.getByLabel('Skip ads')).toHaveValue('false')
  await expect(dialog.getByText('Saved', { exact: true })).toHaveCount(0)
  await dialog.getByLabel('Skip ads').selectOption('true')
  await expect(dialog.getByLabel('AI source')).toHaveValue('personal')
  await expect(dialog.getByLabel('AI source').getByRole('option', { name: 'Personal OpenAI API key', exact: true })).toHaveCount(1)
  await expect(dialog.getByLabel('AI source').getByRole('option', { name: 'BMUX subscription', exact: true })).toHaveCount(1)
  await expect(dialog.getByRole('group', { name: 'Playback', exact: true })).toBeVisible()
  let watch = dialog.getByRole('group', { name: 'Brief watch time', exact: true })
  let minimum = watch.getByRole('slider', { name: 'Brief watch time minimum', exact: true }), maximum = watch.getByRole('slider', { name: 'Brief watch time maximum', exact: true })
  await expect(minimum).toHaveValue('8'); await expect(maximum).toHaveValue('12')
  await expect(watch.getByText(/^Minimum |^Maximum /)).toHaveCount(0)
  await minimum.focus(); await minimum.press('ArrowLeft')
  await maximum.focus(); await maximum.press('ArrowRight')
  await expect(minimum).toHaveValue('7'); await expect(maximum).toHaveValue('13')
  await chrome.screenshot({ path: path.resolve('artifacts/brief-watch-slider.png') })
  await expect(dialog.getByRole('group', { name: 'AI and observation', exact: true })).toBeVisible()
  await expect(dialog.getByRole('group', { name: 'Interactions', exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Skip ads')).toHaveValue('true')
  await expect(dialog.getByRole('option').filter({hasText:'Use saved setting:'})).toHaveCount(0)
  await expect(dialog.getByLabel('Skip ads')).toHaveValue('true')
  await expect(dialog.getByLabel('Duration in seconds')).toHaveValue('60')
  await expect(dialog.getByLabel('Session ID')).toHaveCount(0)
  await dialog.getByRole('textbox', { name:'Persona', exact:true }).fill('tonisdev\nIndie hacking, AI and computers')
  await dialog.getByLabel('AI source').selectOption('included')
  await expect(dialog.getByRole('button', { name: 'Done editing', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Skip ads')).toBeEnabled()
  await expect(dialog.getByLabel('AI source')).toHaveValue('included')
  await fs.mkdir(path.resolve('artifacts'), { recursive: true }); await chrome.screenshot({ path: path.resolve('artifacts/social-plugin-settings.png') })
  await application.evaluate(({ BaseWindow }, bounds) => BaseWindow.getAllWindows().find(window => window.isVisible())!.setBounds({ ...bounds, width: 640, height: 500 }), nativeBounds)
  await expect.poll(() => chrome.evaluate(() => innerWidth)).toBeLessThan(641)
  await expect(dialog.getByRole('region', { name: 'Plugin list', exact: true })).toBeVisible()
  let startBounds = await dialog.getByRole('button', { name: 'Start browsing', exact: true }).boundingBox(), shortViewport = await chrome.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(startBounds!.y + startBounds!.height).toBeLessThan(shortViewport.height)
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await chrome.screenshot({ path: path.resolve('artifacts/social-plugin-settings-short.png') })
  await application.evaluate(({ BaseWindow }, bounds) => BaseWindow.getAllWindows().find(window => window.isVisible())!.setBounds(bounds), nativeBounds)
  await expect.poll(() => chrome.evaluate(() => innerWidth)).toBe(viewport.width)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Back to plugins', exact: true })).toBeVisible()
  expect((await state()).model.sessions.find((session: any) => session.id === client.sessionId).windows.length).toBe(windows)
  let id = await run('launch')
  await expect(dialog.getByRole('button', { name: 'Start browsing', exact: true })).toBeVisible(); await openSettings(dialog)
  await expect(dialog.getByRole('textbox', { name:'Persona', exact:true })).toHaveValue('tonisdev\nIndie hacking, AI and computers')
  await expect(dialog.getByRole('slider', { name: 'Brief watch time minimum', exact: true })).toHaveValue('7')
  await expect(dialog.getByRole('slider', { name: 'Brief watch time maximum', exact: true })).toHaveValue('13')
  await expect(dialog.getByLabel('AI source')).toHaveValue('included')
  await expect(dialog.getByLabel('Skip ads')).toHaveValue('true')
  await dialog.getByLabel('Browsing preset', { exact: true }).selectOption('quick')
  await dialog.getByLabel('Duration in seconds').fill('5')
  await startBrowsing(dialog)
  await completed(id)
  let current = await state(), selected = current.model.clients.find((client: any) => client.id === current.clientId)
  let session = current.model.sessions.find((session: any) => session.id === selected.sessionId), window = session.windows.find((window: any) => window.id === selected.windowId)
  expect(session.windows.length).toBe(windows + 1)
  expect(window.id).not.toBe(source.id)
  expect(window.panes[0].profileId).toBe(profile)
  expect(session.windows.find((window: any) => window.id === source.id).panes[0].url).toBe(url + '/')
  expect((await rpc('plugin.runs')).find((run: any) => run.id === id).result).toEqual({ pane: window.panes[0].id, profile, approved: true, url: url + '/feed', parameters: expect.objectContaining({ seconds: '5', ads: false,watch_range:'7-13',persona:'tonisdev\nIndie hacking, AI and computers' }) })
  expect(await application.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url + '/feed' && contents.isAudioMuted()), url)).toBe(true)
  await expect(dialog).toHaveCount(0)
  await expect(chrome.getByRole('textbox', { name: 'URL or search' })).toHaveCount(0)
})

test('Social Media Stop returns to configuration without Prepare or a new window', async () => {
  let id = await run('launch', { parameters: { session: 'observe' } })
  let dialog = chrome.getByRole('dialog', { name: 'Plugin', exact: true })
  await expect(dialog.getByRole('button', { name: 'Start browsing', exact: true })).toBeVisible()
  await startBrowsing(dialog)
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('#plugin-overlay'))).toBe(true)
  let observer = await overlayForRun(id)
  await expect(observer.getByRole('status')).toHaveText('Browsing')
  let windows = (await state()).model.sessions.flatMap((session: any) => session.windows).length
  await expect(observer.locator('details')).toHaveCount(1)
  await observer.getByText('Details and settings', { exact: true }).click()
  await observer.getByLabel('Page overlay detail').selectOption({ label: 'Full answer' })
  await expect(observer.locator('pre')).toHaveText('Watch')
  await observer.getByRole('button', { name: 'Stop session', exact: true }).click()
  await completed(id)
  await expect(dialog.getByRole('heading', { name: 'Fixture plugin · Simulate feed browsing' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Saved settings', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Start browsing', exact: true })).toBeVisible()
  expect((await state()).model.sessions.flatMap((session: any) => session.windows).length).toBe(windows)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('browsing profiles switch saved settings in place without starting a window', async () => {
  let current = await state(), client = current.model.clients.find((client: any) => client.id === current.clientId)
  let profile = (await rpc('profile.create', { name: 'Named browsing profiles' })).id
  let source = await rpc('new-window', { session: client.sessionId, client: client.id, profile, url })
  await rpc('wait', { pane: source.panes[0].id, selector: '#username' }); await activate()
  let windows = (await state()).model.sessions.flatMap((session: any) => session.windows).length
  await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click()
  let command = chrome.getByRole('combobox', { name: 'Command', exact: true })
  await command.fill('plugins'); await command.press('Enter')
  await expect(chrome.getByRole('dialog', { name: 'Plugins', exact: true })).toBeVisible()
  let id = await run('profiles'), dialog = chrome.getByRole('dialog', { name: 'Plugin', exact: true })
  await expect(dialog.getByRole('region', { name: 'Interaction usage' })).toContainText('Daily likes: 8/20 used')
  await expect(dialog.getByRole('region', { name: 'Interaction usage' })).toContainText('Weekly follows: 3/10 used')
  let selector = dialog.getByRole('combobox', { name: 'Browsing profile', exact: true })
  await expect(selector).toHaveValue('default')
  await dialog.getByRole('button', { name: 'Manage subscription', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'BMUX subscription', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Start browsing', exact: true })).toHaveCount(0)
  await dialog.locator(':scope > header').getByRole('button', { name: 'Back to browsing', exact: true }).click()
  await expect(selector).toHaveValue('default')
  expect((await state()).pluginPrompt.runId).toBe(id)
  await expect(dialog.getByLabel('AI source')).toHaveValue('included')
  await expect(dialog.getByLabel('Browsing preset', { exact: true })).toHaveCount(0)
  let edit = dialog.getByRole('button', { name: 'Edit browsing profile', exact: true })
  let selectionBounds = (await selector.boundingBox())!, editBounds = (await edit.boundingBox())!
  expect(editBounds.x).toBeGreaterThanOrEqual(selectionBounds.x + selectionBounds.width)
  expect(Math.abs(editBounds.y + editBounds.height / 2 - selectionBounds.y - selectionBounds.height / 2)).toBeLessThanOrEqual(1)
  await expect(dialog.getByRole('button', { name: 'New profile', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('textbox', { name: 'Persona', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Edit browsing profile', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Browsing profile', exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Browsing preset', { exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Duration in seconds')).toHaveCount(0)
  await expect(dialog.getByLabel('AI source')).toHaveCount(0)
  await expect(dialog.getByRole('group', { name: 'Session', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('textbox', { name: 'Persona', exact: true })).toHaveValue('Software')
  await expect(dialog.getByRole('button', { name: 'Start browsing', exact: true })).toHaveCount(0)
  await expect(dialog.locator('form').getByRole('button', { name: 'Back to browsing', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'New profile', exact: true }).click()
  await dialog.getByLabel('Profile template', { exact: true }).selectOption('research')
  await dialog.getByRole('button', { name: 'Create profile', exact: true }).click()
  await expect(selector).toHaveValue('profile-1')
  await expect(dialog.getByRole('group', { name: 'Profile settings', exact: true })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Persona', exact: true })).toHaveValue('AI research')
  await dialog.getByRole('textbox', { name: 'Persona', exact: true }).fill('Research experiments')
  await selector.selectOption('default')
  await expect(selector).toHaveValue('default'); await openSettings(dialog)
  await expect(dialog.getByRole('textbox', { name: 'Persona', exact: true })).toHaveValue('Software')
  await selector.selectOption('profile-1')
  await expect(selector).toHaveValue('profile-1'); await openSettings(dialog)
  await expect(dialog.getByRole('textbox', { name: 'Persona', exact: true })).toHaveValue('Research experiments')
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click()
  await dialog.getByLabel('Browsing profile name', { exact: true }).fill('Technical research')
  await dialog.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(selector.locator('option:checked')).toHaveText('Technical research')
  await chrome.screenshot({ path: path.resolve('artifacts/browsing-profiles.png') })
  expect((await state()).model.sessions.flatMap((session: any) => session.windows).length).toBe(windows)
  await expect(dialog.locator(':scope > header').getByRole('button', { name: 'Back to browsing', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'Persona', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Start browsing', exact: true })).toBeVisible()
  expect((await state()).pluginPrompt.runId).toBe(id)
  expect((await state()).pluginRuns.find((item: any) => item.id === id).status).toBe('running')
  await chrome.screenshot({ path: path.resolve('artifacts/browsing-profile-selector.png') })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await completed(id,'cancelled')
  id = await run('profiles'); await expect(selector.locator('option:checked')).toHaveText('Technical research')
  await dialog.getByRole('button', { name: 'Edit browsing profile', exact: true }).click()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(selector).toHaveValue('default'); await expect(selector.getByRole('option')).toHaveCount(1)
  await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
  await dialog.locator(':scope > header').getByRole('button', { name: 'Back to browsing', exact: true }).click()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await completed(id,'cancelled')
  await chrome.keyboard.press('Escape')
})


test('overlay errors replace post details with a clear recovery view', async () => {
  let id = await run('overlay')
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('#plugin-overlay'))).toBe(true)
  let observer = await overlayForRun(id)
  await expect(observer.getByRole('button', { name: 'Trigger AI error', exact: true })).toBeVisible()
  await observer.getByRole('button', { name: 'Minimize page overlay', exact: true }).click()
  await expect(observer.getByRole('tab').first()).toBeVisible()
  await rpc('plugin.overlay.input', { id, control: 'fail' })
  await expect(observer.getByRole('alert')).toContainText('Use up to eight bounded questions')
  await expect(observer.getByRole('alert')).toContainText('HTTP 400')
  await expect(observer.getByRole('heading', { name: 'Post', exact: true })).toHaveCount(0)
  await expect(observer.getByRole('heading', { name: 'AI answer', exact: true })).toHaveCount(0)
  await expect(observer.getByText('Details and settings', { exact: true })).toHaveCount(0)
  await expect(observer.getByRole('button', { name: 'Copy sent payload', exact: true })).toHaveCount(0)
  await observer.screenshot({ path: path.resolve('artifacts/plugin-overlay-error.png') })
  await observer.getByRole('button', { name: 'AI settings', exact: true }).click()
  await expect(observer.getByRole('checkbox', { name: 'Skip ads', exact: true })).toBeFocused()
  await observer.getByRole('button', { name: 'Resume session', exact: true }).click()
  await expect(observer.getByRole('heading', { name: 'Post', exact: true })).toBeVisible()
  await expect(observer.getByRole('alert')).toHaveCount(0)
  await observer.getByRole('button', { name: 'Finish fixture', exact: true }).click()
  await completed(id)
})

test('Social Media AI subscription status and launch eligibility use the AI entitlement', async () => {
  let id = await run('launch'), dialog = chrome.getByRole('dialog', { name: 'Plugin', exact: true })
  await expect(dialog.getByRole('region', { name: 'AI subscription' }).getByRole('status')).toContainText('BMUX AI active')
  await dialog.getByLabel('AI source').selectOption('included')
  await expect(dialog.getByRole('button', { name: 'Start browsing', exact: true })).toBeEnabled()
  await application.evaluate(() => { (globalThis as any).__pluginAIUsage.active = false })
  let windows = (await state()).model.sessions.flatMap((session: any) => session.windows).length
  await startBrowsing(dialog)
  await expect(dialog.getByRole('alert')).toContainText('active BMUX subscription is required')
  await expect(dialog.getByRole('button', { name: 'Start browsing', exact: true })).toBeDisabled()
  expect((await state()).model.sessions.flatMap((session: any) => session.windows).length).toBe(windows)
  await openSettings(dialog)
  await dialog.getByLabel('Caption training').selectOption('true')
  await expect(dialog.getByRole('button', { name: 'Start browsing', exact: true })).toBeEnabled()
  await expect(dialog.getByText('This session does not use subscription AI.', { exact: true })).toBeVisible()
  await dialog.locator(':scope > header').getByRole('button', { name: 'Back to Fixture plugin', exact: true }).click()
  await completed(id, 'cancelled')
  await application.evaluate(() => { (globalThis as any).__pluginAIUsage.active = true })
})

test('plugin decision tree highlights answers and moves settings and usage into popups', async () => {
  await chrome.keyboard.press('Escape'); await activate()
  let id = await run('graph')
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('#plugin-overlay'))).toBe(true)
  let observer = await overlayForRun(id)
  await expect.poll(() => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().flatMap(window => window.contentView.children).some((view: any) => view.webContents?.getURL().endsWith('#plugin-overlay') && view.getVisible()))).toBe(true)
  await expect(observer.getByText('BMUX Accounts', { exact: true })).toBeVisible()
  await expect(observer.getByRole('status', { name: 'AI is deciding' })).toBeVisible()
  let tree = observer.getByRole('tree', { name: 'Possible outcomes' })
  await expect(tree).toHaveAttribute('aria-busy', 'true')
  await expect(observer.getByText('A software demo', { exact: true })).toBeVisible()
  await expect(observer.getByRole('dialog', { name: 'Overlay settings', exact: true })).toHaveCount(0)
  await observer.screenshot({ path: path.resolve('artifacts/plugin-decision-loading.png') })
  await observer.getByRole('button', { name: 'Settings', exact: true }).click()
  let settings = observer.getByRole('dialog', { name: 'Overlay settings', exact: true })
  await expect(settings.getByRole('checkbox', { name: 'Skip ads' })).toBeVisible()
  await settings.getByRole('button', { name: 'Resolve AI decision' }).click()
  await settings.getByRole('button', { name: 'Close popup' }).click()
  await expect(tree).toHaveAttribute('aria-busy', 'false')
  await expect(tree.getByRole('treeitem', { selected: true })).toHaveText('Brief watch80%')
  await expect(observer.getByRole('status', { name: 'AI is deciding' })).toHaveCount(0)
  await observer.screenshot({ path: path.resolve('artifacts/plugin-decision-active.png') })
  await observer.getByRole('button', { name: 'Usage', exact: true }).click()
  let usage = observer.getByRole('dialog', { name: 'Session usage', exact: true })
  await expect(usage.getByText('No usage recorded yet.', { exact: true })).toBeVisible()
  await usage.getByRole('button', { name: 'Close popup' }).click()
  await observer.getByRole('button', { name: 'Start browsing', exact: true }).click()
  let pause = observer.getByRole('button', { name: 'Pause session', exact: true }), next = observer.getByRole('button', { name: 'Show next post', exact: true })
  let pauseBounds = (await pause.boundingBox())!, nextBounds = (await next.boundingBox())!, statusBounds = (await observer.getByRole('status').boundingBox())!
  expect(pauseBounds.width).toBeGreaterThanOrEqual(40); expect(pauseBounds.height).toBeGreaterThanOrEqual(40)
  expect(nextBounds.y).toBe(pauseBounds.y); expect(pauseBounds.y).toBeGreaterThanOrEqual(statusBounds.y + statusBounds.height)
  let likesBounds = (await observer.getByText('1 like · 2 comment reads · 1 profile view', { exact: true }).boundingBox())!, footerBounds = (await observer.getByRole('button', { name: 'Settings', exact: true }).boundingBox())!
  expect(likesBounds.y).toBeGreaterThan(pauseBounds.y + pauseBounds.height); expect(footerBounds.y - likesBounds.y).toBeLessThan(64)
  await expect(observer.getByRole('button', { name: /^Close .+ tab$/ })).toHaveCount(1)
  await observer.screenshot({ path: path.resolve('artifacts/plugin-decision-playback.png') })
  await next.click()
  await expect(observer.getByRole('status')).toHaveText('Showing next post')
  await chrome.getByRole('button', { name: 'Command prompt' }).click()
  let command = chrome.getByRole('combobox', { name: 'Command', exact: true }); await command.fill('extensions'); await command.press('Enter')
  let panel = chrome.getByRole('dialog', { name: 'Extensions', exact: true }), playback = panel.getByRole('button', { name: 'Agent playback actions', exact: true })
  await playback.click()
  let actions = panel.getByRole('group', { name: 'Agent playback actions', exact: true })
  await actions.getByRole('button', { name: 'Pause session', exact: true }).click()
  await expect.poll(async () => (await state()).pluginOverlay.content.status).toBe('Paused')
  await playback.click()
  await actions.getByRole('button', { name: 'Resume session', exact: true }).click()
  await expect.poll(async () => (await state()).pluginOverlay.content.status).toBe('Browsing')
  await panel.getByRole('button', { name: 'Show next post', exact: true }).click()
  await expect.poll(async () => (await state()).pluginOverlay.content.status).toBe('Showing next post')
  await chrome.screenshot({ path: path.resolve('artifacts/plugin-playback-actions.png') })
  await chrome.keyboard.press('Escape')
  await rpc('plugin.overlay.show', { id })
  await observer.getByRole('button', { name: 'Settings', exact: true }).click()
  await settings.getByRole('button', { name: 'Finish fixture', exact: true }).click()
  await completed(id)
})


test('four visible panes each retain a static plugin overlay zoom with independent controls', async () => {
  let current = await state(), client = current.model.clients.find((item: any) => item.id === current.clientId)
  let previousWindow = client.windowId
  let window = await rpc('new-window', { client: client.id, session: client.sessionId, url: url + '/four-overlays' })
  await rpc('wait', { pane: window.panes[0].id, selector: '#username' })
  let original = window.panes[0].id, panes = [original], ids: string[] = []
  let views = pluginViews
  try {
    for (let index = 1; index < 4; index++) {
      let pane = await rpc('split-window', { pane: original, url: url + '/overlay-' + index })
      panes.push(pane.id)
      await rpc('wait', { pane: pane.id, selector: '#username' })
    }
    await rpc('select-layout', { window: window.id, layout: 'tiled' })
    for (let pane of panes) {
      await rpc('zoom', { pane, factor: .5 })
      ids.push(await run('overlay', { pane }))
    }
    await expect.poll(async () => (await views()).length).toBe(4)
    let observers = new Map<string, Page>()
    for (let page of application.context().pages().filter(page => page.url().endsWith('#plugin-overlay'))) {
      let value = await page.evaluate(() => (window as any).bmux.state())
      if (ids.includes(value.pluginOverlay?.runId)) observers.set(value.pluginOverlay.runId, page)
    }
    expect(observers.size).toBe(4)
    for (let page of observers.values()) await page.evaluate(() => {
      let bridge = (window as any).bmux
      ;(window as any).overlayDelivery = { full: 0, overlays: [] }
      bridge.subscribe(() => { (window as any).overlayDelivery.full++ })
      bridge.subscribeOverlay((overlay: unknown) => { (window as any).overlayDelivery.overlays.push(overlay) })
    })
    await rpc('plugin.overlay.input', { id: ids[0], control: 'start' })
    await expect(observers.get(ids[0])!.getByRole('status')).toHaveText('Browsing')
    for (let [id, page] of observers) {
      let delivery = await page.evaluate(() => (window as any).overlayDelivery)
      expect(delivery.full).toBe(0)
      expect(delivery.overlays.length).toBe(id === ids[0] ? 1 : 0)
      expect(delivery.overlays.every((overlay: any) => overlay.runId === id && !('model' in overlay) && !('snapshots' in overlay))).toBe(true)
    }
    for (let [id, page] of observers) {
      let overlay = (await page.evaluate(() => (window as any).bmux.state())).pluginOverlay
      expect(overlay.runId).toBe(id)
      expect(await page.evaluate(() => innerWidth)).toBe(overlay.bounds.width)
      if (id !== ids[0]) await page.getByRole('button', { name: 'Start browsing', exact: true }).click()
      await expect(page.getByRole('status')).toHaveText('Browsing')
    }
    for (let view of await views()) {
      expect(view.zoom).toBe(1)
      expect(view.bounds.width).toBe(384)
      expect(view.bounds.height).toBeGreaterThanOrEqual(240)
      expect(view.bounds.height).toBeLessThanOrEqual(600)
    }
    await rpc('select-pane', { client: client.id, pane: original })
    let originalView = observers.get(ids[0])!
    let originalBounds = (await originalView.evaluate(() => (window as any).bmux.state())).pluginOverlay.bounds
    await rpc('zoom', { pane: original, factor: 1 })
    await expect.poll(async () => (await views()).find(view => view.zoom === 1)?.bounds.width).toBe(384)
    await rpc('zoom', { pane: original, factor: .5 })
    await expect.poll(async () => (await originalView.evaluate(() => (window as any).bmux.state())).pluginOverlay.bounds.height).toBe(originalBounds.height)
    let lastView = observers.get(ids[3])!
    let pageBounds = await application.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().flatMap(window => window.contentView.children).find((view: any) => view.webContents?.getURL() === url)!.getBounds(), url + '/overlay-3')
    let moving = (await lastView.evaluate(() => (window as any).bmux.state())).pluginOverlay
    for (let position of [-10000, 10000]) {
      await lastView.evaluate(({ id, bounds, position }) => (window as any).bmux.command({ method: 'plugin.overlay.bounds', args: { id, ...bounds, x: position, y: position } }), { id: ids[3], bounds: moving.bounds, position })
      let placed = (await lastView.evaluate(() => (window as any).bmux.state())).pluginOverlay
      expect(placed.bounds.x).toBeGreaterThanOrEqual(pageBounds.x)
      expect(placed.bounds.y).toBeGreaterThanOrEqual(pageBounds.y)
      expect(placed.bounds.x + Math.round(placed.bounds.width * placed.zoom)).toBeLessThanOrEqual(pageBounds.x + pageBounds.width)
      expect(placed.bounds.y + Math.round(placed.bounds.height * placed.zoom)).toBeLessThanOrEqual(pageBounds.y + pageBounds.height)
    }
    await originalView.getByRole('button', { name: 'Pause session', exact: true }).click()
    await expect(originalView.getByRole('status')).toHaveText('Paused')
    for (let id of ids.slice(1)) await expect(observers.get(id)!.getByRole('status')).toHaveText('Browsing')
    await observers.get(ids[1])!.getByRole('button', { name: 'Minimize page overlay', exact: true }).click()
    await expect.poll(async () => (await views()).filter(view => view.bounds.height > 32).length).toBe(3)
    expect((await rpc('plugin.runs')).find((run: any) => run.id === ids[1]).status).toBe('running')
    await fs.mkdir(path.resolve('artifacts'), { recursive: true })
    await originalView.screenshot({ path: path.resolve('artifacts/plugin-overlay-scaled-pane.png') })
  } finally {
    for (let id of ids) await rpc('plugin.cancel', { id })
    await rpc('select-window', { client: client.id, window: previousWindow })
    await rpc('kill-window', { window: window.id, confirm: true })
  }
})

test('shared social Settings apply profile and AI choices without starting browsing', async () => {
  await activate()
  let current = await state(), client = current.model.clients.find((item: any) => item.id === current.clientId)
  await rpc('select-pane', { client: client.id, pane: client.paneId })
  await rpc('plugin.run', { action: 'test/profiles', sharedSettings: true })
  let dialog = chrome.getByRole('dialog', { name: 'Plugin', exact: true })
  await expect(dialog.getByRole('heading', { name: 'Social Media settings', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Start browsing', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Record browsing', { exact: true })).toBeChecked()
  await expect(dialog.getByLabel('Include manual browsing', { exact: true })).toBeChecked()
  await dialog.getByLabel('Record browsing', { exact: true }).uncheck()
  await expect(dialog.getByLabel('Include manual browsing', { exact: true })).toBeDisabled()
  await expect.poll(async () => (await state()).browseRecording.enabled).toBe(false)
  await dialog.getByLabel('Record browsing', { exact: true }).check()
  await dialog.getByLabel('Include manual browsing', { exact: true }).uncheck()
  await expect.poll(async () => (await state()).browseRecording.manual).toBe(false)
  await dialog.getByLabel('Include manual browsing', { exact: true }).check()
  await dialog.getByLabel('AI source').selectOption('personal')
  await dialog.getByRole('button', { name: 'Apply all', exact: true }).click()
  await expect(dialog.getByRole('status').filter({ hasText: 'Applied to' })).toBeVisible()
  let request = (await state()).pluginPrompt
  let saved = JSON.parse(await fs.readFile(path.join(directory, 'plugins/test', 'settings-' + encodeURIComponent(request.profileId) + '.json'), 'utf8'))
  expect(saved.ai_source).toBe('personal')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('browsing can use the current pane without creating a window', async () => {
  await activate()
  let before = await state(), client = before.model.clients.find((item: any) => item.id === before.clientId), pane = client.paneId
  await rpc('select-pane', { client: client.id, pane })
  let windows = await rpc('list-windows', { session: client.sessionId })
  await rpc('toggle-pane-zoom', { client: client.id })
  await chrome.getByRole('button', { name: 'Command prompt' }).click()
  let command = chrome.getByRole('combobox', { name: 'Command', exact: true })
  await command.fill('extensions'); await command.press('Enter')
  let panel = chrome.getByRole('dialog', { name: 'Extensions', exact: true })
  await panel.getByRole('button', { name: 'Fixture plugin', exact: true }).click()
  await expect(panel.getByRole('region', { name: 'Plugin details' })).toBeVisible()
  let id = await run('launch')
  let dialog = chrome.getByRole('dialog', { name: 'Plugin', exact: true })
  await dialog.getByLabel('AI source').selectOption('personal')
  await dialog.getByRole('button', { name: 'Start browsing', exact: true }).click()
  await expect(dialog.getByRole('group', { name: 'Where should browsing start?', exact: true })).toBeVisible()
  expect(await rpc('list-windows', { session: client.sessionId })).toHaveLength(windows.length)
  expect((await rpc('plugin.runs')).find((item: any) => item.id === id).result).toBeUndefined()
  await dialog.getByRole('button', { name: 'Current pane', exact: true }).click()
  await expect(chrome.getByRole('dialog')).toHaveCount(0)
  await completed(id)
  expect((await state()).model.clients.find((item: any) => item.id === client.id).zoomedPaneId).toBe(pane)
  expect((await rpc('plugin.runs')).find((item: any) => item.id === id).result.pane).toBe(pane)
  expect(await rpc('list-windows', { session: client.sessionId })).toHaveLength(windows.length)
})


test('plugins and viewport controls share one independently zoomed tabbed pane view', async () => {
  await chrome.keyboard.press('Escape'); await activate()
  let current = await state(), client = current.model.clients.find((item: any) => item.id === current.clientId)
  let created = await rpc('new-window', { client: client.id, session: client.sessionId, url })
  let pane = created.panes[0].id
  await rpc('wait', { pane, selector: '#username' })
  let first = await run('overlay', { pane }), second: string | undefined
  try {
    let observer = await overlayForRun(first)
    second = (await rpc('plugin.run', { action: 'second/overlay', pane })).id
    await expect(observer.getByRole('tab', { name: 'Research notes', exact: true })).toBeVisible()
    await rpc('lock-viewport', { window: created.id, width: 1280, height: 800 })
    let viewport = observer.getByRole('tab', { name: 'Locked viewport', exact: true })
    await expect(viewport).toBeVisible()
    let attached = () => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().flatMap(window => window.contentView.children).filter((view: any) => view.webContents?.getURL().endsWith('#plugin-overlay') && view.getVisible()).length)
    await expect.poll(attached).toBe(1)
    await expect(observer.getByRole('tab', { name: 'Research notes', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(observer.locator('header strong')).toHaveText('Research notes')
    await observer.getByRole('button', { name: 'Start browsing', exact: true }).click()
    await expect(observer.getByRole('status')).toHaveText('Browsing')
    await observer.getByRole('tab', { name: 'Feed training', exact: true }).click()
    await expect(observer.getByRole('status')).toHaveText('Waiting for Start')
    let overlayState = () => observer.evaluate(() => (window as any).bmux.overlayState())
    let before = await overlayState()
    await viewport.click()
    await expect(observer.getByRole('form', { name: 'Viewport settings' })).toBeVisible()
    let corner = observer.getByRole('slider', { name: 'Panel zoom top-right', exact: true })
    await corner.focus(); await observer.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await overlayState()).zoom).toBe(.95)
    let grip = (await corner.boundingBox())!
    await observer.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await observer.mouse.down()
    await observer.mouse.move(grip.x + grip.width / 2 - 16, grip.y + grip.height / 2 + 24)
    await observer.mouse.up()
    await expect.poll(async () => (await overlayState()).zoom).toBeLessThan(.95)
    for (let [edge, dx, dy] of [['top', 0, -12], ['right', 12, 0], ['bottom', 0, 12], ['left', -12, 0], ['top-left', -12, -12], ['top-right', 12, -12], ['bottom-left', -12, 12], ['bottom-right', 12, 12]] as const) {
      let beforeResize = (await overlayState()).zoom
      let handle = observer.getByRole('slider', { name: `Panel zoom ${edge}`, exact: true }), box = (await handle.boundingBox())!
      await observer.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await observer.mouse.down()
      await observer.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy)
      await observer.mouse.up()
      await expect.poll(async () => (await overlayState()).zoom).toBeGreaterThan(beforeResize)
    }
    let layout = await observer.evaluate(() => {
      let tab = document.querySelector('[role="tab"][aria-label="Research notes"]')!.getBoundingClientRect()
      let close = document.querySelector('[aria-label="Close Research notes tab"]')!.getBoundingClientRect()
      let minimize = document.querySelector('[aria-label="Minimize page overlay"]')!.getBoundingClientRect()
      return { closeRight: tab.right - close.right, closeTop: close.top - tab.top, rightGap: innerWidth - minimize.right }
    })
    expect(Math.abs(layout.closeRight)).toBeLessThanOrEqual(1)
    expect(Math.abs(layout.closeTop)).toBeLessThanOrEqual(1)
    expect(layout.rightGap).toBeCloseTo(1, 0)
    let scaled = await overlayState()
    await rpc('zoom', { pane, factor: .5 })
    expect((await overlayState()).zoom).toBe(scaled.zoom)
    await rpc('zoom', { pane, factor: 1.5 })
    expect((await overlayState()).zoom).toBe(scaled.zoom)
    await expect.poll(async () => (await pluginViews())[0].zoom).toBeCloseTo(scaled.zoom, 5)
    await observer.getByRole('tab', { name: 'Agent control', exact: true }).click()
    await expect(observer.getByRole('button', { name: /^Close .+ tab$/ })).toHaveCount(2)
    expect((await overlayState()).zoom).toBe(scaled.zoom)
    await observer.getByRole('tab', { name: 'Research notes', exact: true }).click()
    expect((await overlayState()).bounds.width).toBe(before.bounds.width)
    expect((await overlayState()).zoom).toBe(scaled.zoom)
    let selected = observer.getByRole('tab', { name: 'Research notes', exact: true })
    await expect(selected.locator('..')).toHaveCSS('border-bottom-color', 'rgb(167, 182, 156)')
    await expect(selected).toHaveCSS('border-radius', '0px')
    await expect(observer.getByRole('status')).toHaveText('Browsing')
    await observer.screenshot({ path: path.resolve('artifacts/shared-pane-overlay.png') })
    await observer.getByRole('tab', { name: 'Agent control', exact: true }).click()
    await observer.getByRole('button', { name: 'Minimize page overlay', exact: true }).click()
    await expect.poll(async () => (await pluginViews())[0].bounds.height).toBe(Math.round(32 * scaled.zoom))
    await expect(observer.getByRole('tab', { name: 'Agent control', exact: true })).toHaveAttribute('aria-selected', 'false')
    await expect(observer.getByRole('tab')).toHaveCount(4)
    await expect(observer.getByRole('button', { name: /^Close .+ tab$/ })).toHaveCount(2)
    expect((await overlayState()).selectedTab).toBe('agent')
    for (let zoom of [scaled.zoom, 1, 2]) {
      await observer.evaluate(({ pane, zoom }) => (window as any).bmux.command({ method: 'pane.overlay.zoom', args: { pane, zoom } }), { pane, zoom })
      await expect.poll(async () => (await pluginViews())[0].bounds.width).toBe(Math.round(130 * zoom))
      let geometry = await observer.evaluate(() => {
        let panel = document.querySelector('[role="tabpanel"]')!, strip = document.querySelector('[role="tablist"]')!
        let bounds = panel.getBoundingClientRect(), tabs = [...strip.querySelectorAll<HTMLButtonElement>('[role=tab]')]
        return { left: tabs[0].getBoundingClientRect().left - bounds.left, right: bounds.right - tabs.at(-1)!.getBoundingClientRect().right, bottom: bounds.bottom - tabs[0].getBoundingClientRect().bottom, top: tabs[0].getBoundingClientRect().top - bounds.top, overflow: strip.scrollWidth - strip.clientWidth, centers: tabs.map(tab => {
          let button = tab.getBoundingClientRect(), icon = tab.querySelector('svg,img')!.getBoundingClientRect()
          return { x: (icon.left + icon.right - button.left - button.right) / 2, y: (icon.top + icon.bottom - button.top - button.bottom) / 2 }
        }) }
      })
      expect(Math.abs(geometry.left - geometry.right)).toBeLessThanOrEqual(1)
      expect(Math.abs(geometry.top - geometry.bottom)).toBeLessThanOrEqual(1)
      expect(geometry.overflow).toBeLessThanOrEqual(1)
      expect(geometry.centers.every(center => Math.abs(center.x) <= 1 && Math.abs(center.y) <= 1)).toBe(true)
    }
    await observer.screenshot({ path: path.resolve('artifacts/collapsed-pane-overlay.png') })
    let dismiss = observer.getByRole('button', { name: 'Close Research notes tab', exact: true })
    await expect(dismiss.locator('..').getByRole('tab', { name: 'Research notes', exact: true })).toBeVisible()
    await dismiss.click()
    await expect(observer.getByRole('tab', { name: 'Research notes', exact: true })).toHaveCount(0)
    await expect(observer.getByRole('tab', { name: 'Feed training', exact: true })).toBeVisible()
    await expect(observer.getByRole('tab', { name: 'Agent control', exact: true })).toBeVisible()
    expect((await overlayState()).bounds.collapsed).toBe(true)
    expect((await rpc('plugin.runs')).find((run: any) => run.id === second).status).toBe('running')
    expect((await state()).model.clients.find((item: any) => item.id === client.id).paneId).toBe(pane)
  } finally {
    await rpc('plugin.cancel', { id: first })
    if (second) await rpc('plugin.cancel', { id: second })
    await rpc('select-window', { client: client.id, window: client.windowId })
    await rpc('kill-window', { window: created.id, confirm: true })
  }
})


test('social plugin startup shows its confirmation before any empty post or decision tree', async () => {
  await chrome.keyboard.press('Escape'); await activate()
  let id = await run('startup')
  try {
    let observer = await overlayForRun(id)
    await expect(observer.getByRole('heading', { name: 'Ready to browse', exact: true })).toBeVisible()
    await expect(observer.getByText('No post yet', { exact: true })).toHaveCount(0)
    await expect(observer.getByRole('tree')).toHaveCount(0)
    await expect(observer.getByRole('button', { name: 'Start browsing', exact: true })).toBeVisible()
    await expect(observer.getByText('Default · bluesky', { exact: true })).toBeVisible()
    await expect(observer.getByText('Default · bluesky · Confirm actions', { exact: true })).toHaveCount(0)
    await expect(observer.getByRole('spinbutton', { name: 'Duration in seconds' })).toHaveValue('120')
    await expect(observer.getByLabel('Action approval')).toHaveValue('Confirm actions')
    await observer.getByLabel('Action approval').selectOption('Auto continue')
    await expect(observer.getByRole('button', { name: 'Start with auto continue', exact: true })).toHaveCount(0)
    await observer.screenshot({ path: path.resolve('artifacts/plugin-startup-settings.png') })
    await observer.getByRole('button', { name: 'Start browsing', exact: true }).click()
    await expect(observer.getByRole('heading', { name: 'Ready to browse', exact: true })).toHaveCount(0)
    await expect(observer.getByRole('tree')).toBeVisible()
    await expect(observer.getByRole('button', { name: 'Pause session', exact: true })).toBeVisible()
  } finally { await rpc('plugin.cancel', { id }) }
})
