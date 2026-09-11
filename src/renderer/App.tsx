import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent, PointerEvent, MouseEvent } from 'react'
import type { Bookmark, Bridge, Download, Layout, Permission, PublicState } from '../shared/types'
import css from './App.module.css'
import { DEFAULT_KEYBOARD } from '../shared/keyboard'

type ManagementControl = 'rename-window' | 'rename-session' | 'close-window'
type Control = ManagementControl | 'address' | 'command' | 'find' | 'help' | 'sessions' | 'tabs' | 'bookmarks' | 'activity' | 'profiles' | 'settings' | 'plugins' | 'plugin-dialog'
type UIContext = { state: PublicState; control: Control | null; message: string; onMessage: (message: string) => void; run: (method: string, args?: Record<string, unknown>) => Promise<unknown>; show: (control: Control, paneId?: string) => void; dismiss: () => void }

export let App = () => {
  let [state, setState] = useState<PublicState | null>(null)
  let [control, setControl] = useState<Control | null>(null)
  let [message, setMessage] = useState('')
  let previous = useRef('')
  let accept = useCallback((next: PublicState) => {
    let { client, tab } = selection(next)
    let target = `${client?.windowId}:${client?.paneId}:${tab?.id}`
    if (previous.current && previous.current !== target) { setControl(null); setMessage('') }
    if (next.pluginPrompt) setControl('plugin-dialog')
    else setControl(current => current === 'plugin-dialog' ? null : current)
    previous.current = target; setState(next)
  }, [])
  let run = useCallback(async (method: string, args: Record<string, unknown> = {}) => {
    try { return await bridge.command({ method, args }) }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return undefined }
  }, [])
  let show = useCallback(async (control: Control, paneId?: string) => {
    if (paneId) {
      let current = await bridge.state()
      if (selection(current).pane?.id !== paneId) {
        if (await run('select-pane', { client: current.clientId, pane: paneId, focus: false }) === undefined) return
        current = await bridge.state()
      }
      accept(current)
    }
    setMessage(''); setControl(control)
  }, [accept, run])
  let dismiss = useCallback(() => {
    if (state?.pluginPrompt) void bridge.command({ method: 'plugin.respond', args: { id: state.pluginPrompt.id, cancel: true } }).catch(() => undefined)
    setControl(null); setMessage('')
  }, [state?.pluginPrompt])
  useEffect(() => {
    let unsubscribe = bridge.subscribe(accept)
    void bridge.state().then(accept).catch(error => setMessage(String(error)))
    let controls = bridge.controls(control => { void bridge.state().then(next => { accept(next); if (control !== 'plugin-dialog') show(control as Control) }) })
    return () => { unsubscribe(); controls() }
  }, [accept, show])
  let management = control === 'rename-window' || control === 'rename-session' || control === 'close-window'
  let prompt = management || control === 'address' || control === 'command' || control === 'find'
  let panel = control && !prompt ? control : null
  useEffect(() => {
    if (state?.clientId) void run('client.overlay', { client: state.clientId, visible: !!panel })
  }, [panel, state?.clientId, run])
  useEffect(() => {
    let escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [dismiss])
  if (!state) return <div className={css.empty}>{message || 'Starting…'}</div>
  let { client, window } = selection(state)
  if (!client || !window) return <div className={css.empty}>Attaching…</div>
  let layout = client.zoomedPaneId && window.panes.some(pane => pane.id === client.zoomedPaneId) ? { kind: 'pane' as const, paneId: client.zoomedPaneId } : window.layout
  let context = { state, control, message, onMessage: setMessage, run, show, dismiss }
  return <Context.Provider value={context}><div className={css.app} data-status-bar={state.statusBar ?? 'top'}>
    <main className={css.workspace}>{layout ? <Branch node={layout} /> : <section className={css.pane}><PaneAddress /><EmptyPane /></section>}</main>
    <footer className={css.status} aria-label="Browser status">
      {control === 'rename-window' || control === 'rename-session' || control === 'close-window' ? <ManagementPrompt key={`${control}:${client.windowId}`} mode={control} message={message} /> : control === 'command' || control === 'find' ? <Prompt key={`${control}:${client.windowId}:${client.paneId}`} mode={control} message={message} onMessage={setMessage} /> : <Status message={control === 'address' ? '' : message} />}
    </footer>
    {panel && <Panel key={panel} type={panel} />}
  </div></Context.Provider>
}

let bridge = (window as unknown as { bmux: Bridge }).bmux
let Context = createContext<UIContext | null>(null)
let useUI = () => useContext(Context)!
let selection = (state: PublicState) => {
  let client = state.model.clients.find(client => client.id === state.clientId)
  let session = state.model.sessions.find(session => session.id === client?.sessionId)
  let window = session?.windows.find(window => window.id === client?.windowId)
  let pane = window?.panes.find(pane => pane.id === client?.paneId)
  let tab = pane?.tabs.find(tab => tab.id === pane.activeTabId)
  let profile = state.model.profiles.find(profile => profile.id === pane?.profileId)
  return { client, session, window, pane, tab, profile }
}

let Status = ({ message }: { message: string }) => {
  let { state, show } = useUI()
  let { client, session, pane, tab, profile } = selection(state)
  let sessions = () => show('sessions')
  let tabs = () => show('tabs')
  let help = () => show('help')
  let commands = () => show('command')
  let activity = () => show('activity')
  return <><button onClick={sessions} aria-label="Sessions" className={css.session}>[{session!.name}]</button>
    <div className={css.windows}>{session!.windows.map((window, index) => <StatusWindow key={window.id} id={window.id} label={`${index}:${window.name}${window.id === client!.windowId ? '*' : ''}`} active={window.id === client!.windowId} />)}</div>
    <button onClick={tabs} aria-label="Tabs" title="Active browser profile and tabs">profile:{profile?.name}{pane && pane.tabs.length > 1 ? ` ${pane.tabs.findIndex(item => item.id === tab?.id) + 1}/${pane.tabs.length}` : ''}</button>
    <span className={css.drag} />{(message || state.configError) && <span className={css.error} title={message || state.configError || undefined}>{message || state.configError}</span>}
    {state.permissions.length > 0 && <button onClick={activity} aria-label="Activity">permission:{state.permissions.length}</button>}
    <button onClick={commands} aria-label="Command prompt">:</button><button onClick={help} aria-label="Help" title="Ctrl+B then ?">?</button>
  </>
}
let StatusWindow = ({ id, label, active }: { id: string; label: string; active: boolean }) => {
  let { state, run } = useUI()
  let select = () => { void run('select-window', { client: state.clientId, window: id }) }
  return <button onClick={select} data-active={active}>{label}</button>
}

let commandHistory: string[] = []
let Prompt = ({ mode, message, onMessage }: { message: string; mode: 'address' | 'command' | 'find'; onMessage: (message: string) => void }) => {
  let { state, run, show, dismiss } = useUI()
  let { client, pane, tab } = selection(state)
  let [text, setText] = useState(mode === 'address' && tab?.url !== 'about:blank' ? tab?.url ?? '' : '')
  let [busy, setBusy] = useState(false)
  let ref = useRef<HTMLInputElement>(null)
  let historyIndex = useRef(commandHistory.length)
  let mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  let change = (event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)
  let submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim() || busy) return
    if (mode === 'command' && ['plugins', 'help', 'sessions', 'tabs', 'bookmarks', 'activity', 'profiles', 'settings'].includes(text.trim())) { show(text.trim() as Control); return }
    setBusy(true)
    let result: unknown
    if (mode === 'command') {
      commandHistory.push(text); commandHistory = commandHistory.slice(-100)
      result = await run('command-line', { client: client!.id, line: text })
    } else {
      let target = tab?.id
      if (!target && mode === 'address') {
        let created = await run('split-window', { window: client!.windowId, client: client!.id }) as { activeTabId: string } | undefined
        target = created?.activeTabId
      }
      result = target ? await run(mode === 'address' ? 'navigate' : 'find', { tab: target, ...(mode === 'address' ? { url: text, waitUntil: 'none' } : { text, next: true }) }) : undefined
    }
    if (!mounted.current) return
    setBusy(false)
    if (result === undefined) { if (!tab && !pane && mode !== 'command') onMessage('Create a pane first'); return }
    dismiss()
    void run('focus-page', { client: client!.id })
  }
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { dismiss(); void run('focus-page', { client: client!.id }); return }
    if (mode !== 'command' || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    historyIndex.current = Math.max(0, Math.min(commandHistory.length, historyIndex.current + (event.key === 'ArrowUp' ? -1 : 1)))
    setText(commandHistory[historyIndex.current] ?? '')
  }
  return <form className={css.prompt} onSubmit={submit}><label htmlFor="prompt">{mode === 'command' ? ':' : mode === 'find' ? '/' : 'open'}</label><input id="prompt" ref={ref} aria-label={mode === 'address' ? 'URL or search' : mode === 'command' ? 'Command' : 'Find in page'} value={text} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} readOnly={busy} /><span className={message ? css.error : undefined} role="status">{message || (busy ? 'loading…' : 'esc')}</span><button type="submit" className={css.submit} aria-label="Submit">Enter</button></form>
}

let ManagementPrompt = ({ mode, message }: { mode: ManagementControl; message: string }) => {
  let { state, run, dismiss } = useUI()
  let { client, session, window } = selection(state)
  let closing = mode === 'close-window'
  let [text, setText] = useState(closing ? '' : mode === 'rename-session' ? session!.name : window!.name)
  let [busy, setBusy] = useState(false)
  let ref = useRef<HTMLInputElement>(null)
  let mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  let finish = () => { dismiss(); void run('focus-page', { client: client!.id }) }
  let apply = async () => {
    if (busy) return
    setBusy(true)
    let result = await run(closing ? 'kill-window' : mode, { client: client!.id, window: window!.id, session: session!.id, ...(closing ? { confirm: true } : { name: text.trim() }) })
    if (!mounted.current) return
    setBusy(false)
    if (result !== undefined) finish()
  }
  let submit = (event: FormEvent) => { event.preventDefault(); if (closing ? text.toLowerCase() === 'y' : text.trim()) void apply() }
  let change = (event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' || (closing && event.key.toLowerCase() === 'n')) { event.preventDefault(); finish(); return }
    if (closing && event.key.toLowerCase() === 'y') { event.preventDefault(); void apply() }
  }
  let label = closing ? `Close window "${window!.name}"? (y/n)` : mode === 'rename-session' ? 'Rename session' : 'Rename window'
  return <form className={css.prompt} onSubmit={submit}><label htmlFor="manage">{label}</label><input id="manage" ref={ref} aria-label={closing ? 'Close window confirmation' : label} value={text} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} readOnly={busy} /><span className={message ? css.error : undefined} role="status">{message || 'esc'}</span><button type="submit" className={css.submit} aria-label="Submit">Enter</button></form>
}

let EmptyPane = ({ paneId }: { paneId?: string }) => {
  let { show } = useUI()
  let open = () => show('address', paneId)
  return <div className={css.empty}><button onClick={open}>Cmd+L to open a URL</button></div>
}
let PaneAddress = ({ paneId }: { paneId?: string }) => {
  let { state, control, message, onMessage, show } = useUI()
  let { client, window } = selection(state)
  let pane = window?.panes.find(pane => pane.id === paneId)
  let tab = pane?.tabs.find(tab => tab.id === pane.activeTabId)
  let editing = control === 'address' && (client?.paneId === paneId || !paneId)
  let open = () => show('address', paneId)
  return <div className={css.addressBar} role="group" aria-label="Pane address">
    {editing ? <Prompt key={tab?.id ?? 'empty'} mode="address" message={message} onMessage={onMessage} /> : <button onClick={open} aria-label="Address" className={css.location} title={tab?.url}>{tab?.url && tab.url !== 'about:blank' ? tab.url : 'Cmd+L to open a URL'}</button>}
    {!editing && tab && state.loading[tab.id] && <span className={css.loading}>loading…</span>}
  </div>
}
let Branch = ({ node }: { node: Layout }) => {
  let { state, run } = useUI()
  let ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (node.kind === 'split') ref.current?.style.setProperty('--ratio', String(node.ratio)) }, [node])
  let startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (node.kind !== 'split' || !ref.current) return
    event.preventDefault()
    let { client } = selection(state)
    let bounds = ref.current.getBoundingClientRect(), ratio = node.ratio, gutter = event.currentTarget
    gutter.setPointerCapture(event.pointerId)
    void run('client.overlay', { client: client!.id, visible: true })
    let move = (event: globalThis.PointerEvent) => { ratio = Math.max(.1, Math.min(.9, node.axis === 'horizontal' ? (event.clientX - bounds.x) / bounds.width : (event.clientY - bounds.y) / bounds.height)); ref.current?.style.setProperty('--ratio', String(ratio)) }
    let end = () => {
      gutter.removeEventListener('pointermove', move); gutter.removeEventListener('pointerup', end); gutter.removeEventListener('pointercancel', end)
      void run('resize-pane', { window: client!.windowId, split: node.id, ratio }).then(() => run('client.overlay', { client: client!.id, visible: false }))
    }
    gutter.addEventListener('pointermove', move); gutter.addEventListener('pointerup', end); gutter.addEventListener('pointercancel', end)
  }
  if (node.kind === 'pane') return <BrowserPane paneId={node.paneId} />
  return <div ref={ref} className={css.branch} data-axis={node.axis}><div className={css.first}><Branch node={node.first} /></div><div className={css.gutter} role="separator" aria-label="Resize split" onPointerDown={startDrag} /><div className={css.second}><Branch node={node.second} /></div></div>
}
let BrowserPane = ({ paneId }: { paneId: string }) => {
  let { state, run } = useUI()
  let { client } = selection(state)
  let pane = state.model.sessions.flatMap(session => session.windows.flatMap(window => window.panes)).find(pane => pane.id === paneId)!
  let tab = pane.tabs.find(tab => tab.id === pane.activeTabId)!
  let ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    let publish = () => bridge.bounds([...document.querySelectorAll<HTMLElement>('[data-browser-content]')].map(element => { let rect = element.getBoundingClientRect(); return { tabId: element.dataset.tabId!, x: rect.x, y: rect.y, width: rect.width, height: rect.height } }))
    let observer = new ResizeObserver(publish)
    if (ref.current) observer.observe(ref.current)
    publish()
    return () => observer.disconnect()
  }, [tab.id, client!.windowId, state.statusBar])
  let focus = () => { if (client!.paneId !== pane.id) void run('select-pane', { client: client!.id, pane: pane.id }) }
  let reload = () => { void run('reload', { tab: tab.id }) }
  let snapshot = state.snapshots[tab.id]
  return <section className={css.pane} data-pane-id={pane.id} data-focused-pane={client!.paneId === pane.id}><PaneAddress paneId={pane.id} /><div className={css.content} ref={ref} data-browser-content data-tab-id={tab.id} onMouseDown={focus}>
    {state.crashes[tab.id] ? <div className={css.empty}><span>{state.crashes[tab.id]}</span><button onClick={reload}>Reload</button></div> : tab.url === 'about:blank' ? <EmptyPane paneId={pane.id} /> : snapshot ? <img className={css.preview} src={snapshot.image} alt="Page preview" /> : <div className={css.empty}>{state.loading[tab.id] ? 'Loading…' : ''}</div>}
  </div></section>
}

let Panel = ({ type }: { type: Control }) => {
  let { state, dismiss } = useUI()
  let { pane, profile } = selection(state)
  let ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!['sessions', 'plugin-dialog', 'plugins'].includes(type)) ref.current?.focus() }, [type])
  let title = type === 'plugin-dialog' ? 'Plugin' : type.charAt(0).toUpperCase() + type.slice(1)
  return <div className={css.overlay}><div className={css.panel} role="dialog" aria-label={title} tabIndex={-1} ref={ref}>
    <header><strong>{title}</strong><button onClick={dismiss}>Close</button></header>
    {type === 'help' && <><HelpContent /><p>Use <code>plugins</code> for plugin actions and <code>activity</code> for running scripts.</p></>}
    {type === 'plugins' && <PluginList />}
    {type === 'plugin-dialog' && state.pluginPrompt && <PluginDialog key={state.pluginPrompt.id} />}
    {type === 'settings' && <KeyboardSettings />}
    {type === 'sessions' && <SessionPicker />}
    {type === 'tabs' && <><p>{profile?.name}</p>{pane?.tabs.map((tab, index) => <TabRow key={tab.id} id={tab.id} label={`${index}: ${tab.title}`} url={tab.url} active={tab.id === pane.activeTabId} />)}</>}
    {type === 'profiles' && <>{state.model.profiles.map(profile => <div key={profile.id} className={css.row}>{profile.name}{profile.background ? ' (background)' : ''}</div>)}<p>Use <code>new-session -s NAME --profile PROFILE</code> or <code>split-window --profile PROFILE</code>.</p></>}
    {type === 'bookmarks' && <><p>Profile: {profile?.name ?? 'No selected pane'}</p>{profile?.bookmarks?.length ? profile.bookmarks.map(bookmark => <BookmarkRow key={bookmark.id} bookmark={bookmark} />) : <p>No bookmarks in this profile.</p>}</>}
    {type === 'activity' && <><PluginActivity /><p>Permissions</p>{state.permissions.length ? state.permissions.map(permission => <PermissionRow key={permission.id} permission={permission} />) : <p>No pending requests.</p>}<p>Downloads</p>{state.downloads.map(download => <DownloadRow key={download.id} download={download} />)}</>}
  </div></div>
}
let PluginList = () => {
  let { state, run, dismiss } = useUI()
  let [query, setQuery] = useState('')
  let choose = (event: MouseEvent<HTMLButtonElement>) => { dismiss(); void run('plugin.run', { action: event.currentTarget.dataset.action }) }
  let reload = () => { void run('plugin.reload') }
  let change = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)
  return <><label>Find plugin action<input className={css.pluginInput} value={query} onChange={change} autoFocus /></label>
    {!state.plugins?.length && <p>No plugins found. Add folders containing plugin.yaml beside your config, in plugins/.</p>}
    {state.plugins?.map(plugin => <div key={plugin.id}><p>{plugin.name} · {plugin.enabled ? 'enabled' : 'disabled'}{plugin.error ? ` · ${plugin.error}` : ''}</p>
      {plugin.actions.filter(action => `${plugin.name} ${action.title}`.toLowerCase().includes(query.toLowerCase())).map(action => <button key={action.id} className={css.row} disabled={!plugin.enabled} data-action={`${plugin.id}/${action.id}`} onClick={choose}>{action.title}{action.description && <span className={css.pluginDescription}>{action.description}</span>}</button>)}</div>)}
    <p>Enable plugins in config.yaml. Scripts run with your OS user privileges.</p><button onClick={reload}>Reload plugins</button></>
}
let PluginActivity = () => {
  let { state, run } = useUI()
  let cancel = (event: MouseEvent<HTMLButtonElement>) => { void run('plugin.cancel', { id: event.currentTarget.dataset.id }) }
  return <><p>Plugin runs</p>{state.pluginRuns?.length ? state.pluginRuns.map(item => <div key={item.id} className={css.row}>{item.title} · {item.status}
    {item.progress && <span className={css.pluginDescription}>{item.progress.percent}% · {item.progress.message}</span>}{item.error && <span className={css.pluginDescription}>{item.error}</span>}
    {['running', 'queued'].includes(item.status) && <button data-id={item.id} onClick={cancel}>Cancel</button>}</div>) : <p>No plugin runs.</p>}</>
}
let PluginDialog = () => {
  let { state, run } = useUI()
  let request = state.pluginPrompt!
  let [value, setValue] = useState(''), [index, setIndex] = useState(0), [busy, setBusy] = useState(false)
  let ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  let items = request.items?.filter(item => `${item.label} ${item.description ?? ''}`.toLowerCase().includes(value.toLowerCase())) ?? []
  let respond = async (value: string | boolean) => {
    if (busy) return
    setBusy(true); await run('plugin.respond', { id: request.id, value }); setValue(''); setBusy(false)
  }
  let change = (event: ChangeEvent<HTMLInputElement>) => { setValue(event.target.value); setIndex(0) }
  let yes = () => { void respond(true) }
  let no = () => { void respond(false) }
  let pick = (event: MouseEvent<HTMLButtonElement>) => { void respond(event.currentTarget.dataset.id!) }
  let submit = (event: FormEvent) => { event.preventDefault(); if (request.kind === 'pick') { if (items[index]) void respond(items[index].id) } else void respond(value) }
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (request.kind !== 'pick' || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); setIndex(index => Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
  }
  return <><p>{request.pluginName}</p>{request.kind === 'confirm' ? <><p>{request.title}</p><button autoFocus onClick={yes}>Yes</button><button onClick={no}>No</button></> : <form onSubmit={submit}>
    <label>{request.title}<input ref={ref} className={css.pluginInput} type={request.kind === 'password' ? 'password' : 'text'} value={value} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} required={request.kind !== 'pick' && request.required} /></label>
    {request.kind === 'pick' ? items.map((item, position) => <button key={item.id} type="button" className={css.row} data-id={item.id} data-active={position === index} disabled={busy} onClick={pick}>{item.label}{item.description && <span className={css.pluginDescription}>{item.description}</span>}</button>) : <button type="submit" disabled={busy}>Continue</button>}
    {request.kind === 'pick' && !items.length && <p>No matching items.</p>}
  </form>}</>
}
let SessionPicker = () => {
  let { state } = useUI()
  let ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('[data-active="true"]')?.focus() }, [])
  let keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return
    event.preventDefault()
    let rows = [...ref.current!.querySelectorAll<HTMLButtonElement>('button')]
    let index = rows.findIndex(row => row === document.activeElement)
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index + ({ ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[event.key] ?? 0)
    let row = rows[Math.max(0, Math.min(rows.length - 1, next))]
    row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' })
  }
  return <div ref={ref} onKeyDown={keys} role="group" aria-label="Choose session"><p>Up/Down to move, Enter to attach, Escape to cancel.</p>{state.model.sessions.map(session => <SessionRow key={session.id} id={session.id} name={session.name} />)}</div>
}
let SessionRow = ({ id, name }: { id: string; name: string }) => {
  let { state, run, dismiss } = useUI()
  let active = selection(state).client?.sessionId === id
  let select = async () => { if (await run('switch-client', { client: state.clientId, session: id })) { dismiss(); await run('client.overlay', { client: state.clientId, visible: false }); await run('focus-page', { client: state.clientId }) } }
  return <button className={css.row} onClick={select} data-active={active} aria-current={active ? 'true' : undefined}>{name}</button>
}
let TabRow = ({ id, label, url, active }: { id: string; label: string; url: string; active: boolean }) => {
  let { run, dismiss } = useUI()
  let select = async () => { if (await run('tab.select', { tab: id })) dismiss() }
  return <button className={css.row} onClick={select} title={url} data-active={active}>{label}{active ? ' *' : ''}</button>
}
let BookmarkRow = ({ bookmark }: { bookmark: Bookmark }) => {
  let { state, run, dismiss } = useUI()
  let { client } = selection(state)
  let supported = !!bookmark.url && /^(https?:|file:)/i.test(bookmark.url)
  let activate = async () => { if (supported && client?.paneId && await run('tab.create', { pane: client.paneId, url: bookmark.url, client: client.id })) dismiss() }
  if (bookmark.children) return <details className={css.folder} open><summary>{bookmark.title || 'Untitled folder'}</summary><div>{bookmark.children.map(child => <BookmarkRow key={child.id} bookmark={child} />)}</div></details>
  return <button className={css.row} disabled={!supported} onClick={activate} title={supported ? bookmark.url : 'Unsupported URL type'}>{bookmark.title || bookmark.url}</button>
}
let PermissionRow = ({ permission }: { permission: Permission }) => {
  let { run } = useUI()
  let deny = () => { void run('permission.respond', { id: permission.id, allow: false }) }
  let allow = () => { void run('permission.respond', { id: permission.id, allow: true }) }
  return <div className={css.row}>{permission.origin}: {permission.permission}<div><button onClick={deny}>Deny</button><button onClick={allow}>Allow</button></div></div>
}
let DownloadRow = ({ download }: { download: Download }) => {
  let { run } = useUI()
  let reveal = () => { void run('download.reveal', { id: download.id }) }
  return <button className={css.row} onClick={reveal}>{download.name} — {download.state}</button>
}

let HelpContent = () => {
  let { state } = useUI()
  let keyboard = state.keyboard ?? DEFAULT_KEYBOARD
  let bindings = [...Object.entries(keyboard.shortcuts), ...Object.entries(keyboard.prefixBindings).map(([key, action]) => [`${keyboard.prefix} then ${key}`, action])]
  return <><dl>{bindings.map(([key, action]) => <div key={key}><dt>{key}</dt><dd>{action}</dd></div>)}</dl><p>In the session picker: Up/Down moves, Home/End jumps, PageUp/PageDown scrolls, Enter attaches, and Escape cancels. Closing an internal window asks for y/n. Closing a native client leaves its session running.</p><p>Commands use the current session, window, pane, and tab unless you provide a target. Quote names containing spaces. Window and tab indices start at 0.</p><pre>{'open example.com\nnew-session -s work --profile professional\nsession personal\nnew-window -n research\nselect-window -t 1\nsplit-window -h --profile bot\nnext-pane\ntoggle-pane-zoom\npane-left / pane-down / pane-up / pane-right\ntab new https://example.com\ntab select -t 0\nsave-layout work\nrestore-layout work --confirm\nrename-window -n reading\nkill-pane --confirm\nprofile create project --background\nprofiles / sessions / tabs / bookmarks / activity\nback / forward / reload / zoom 110\nnew-client / detach\nimport-brave\nprefix b'}</pre><p>Drag the blank area of the status bar to move this macOS window.</p></>
}

let KeyboardSettings = () => {
  let { state, run } = useUI()
  let keyboard = state.keyboard ?? DEFAULT_KEYBOARD
  let edit = () => { void run('settings.open') }
  let reload = () => { void run('settings.reload') }
  return <><p>{state.configPath}</p><p>Changes reload automatically. Set a binding to null to disable it. Invalid edits keep the last working configuration.</p>{state.configError && <p className={css.error}>{state.configError}</p>}<p>Status bar: {state.statusBar ?? 'top'}. Set <code>statusBar: top</code> or <code>statusBar: bottom</code>.</p><p>Accessibility: {state.accessibility ? 'enabled' : 'automatic'}. Set <code>accessibility: true</code> in the config to expose page controls to oVim and other accessibility tools.</p><p>Prefix: {keyboard.prefix}</p><pre>{'statusBar: top\nkeyboard:\n  prefix: Ctrl+B\n  shortcuts:\n    Cmd+R: reload\n    Cmd+,: settings\n  prefixBindings:\n    ":": command'}</pre><button onClick={edit}>Edit config</button><button onClick={reload}>Reload config</button></>
}
