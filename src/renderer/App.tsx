import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent, PointerEvent } from 'react'
import type { Bookmark, Bridge, Download, Layout, Permission, PublicState } from '../shared/types'
import css from './App.module.css'
import { DEFAULT_KEYBOARD } from '../shared/keyboard'

type Control = 'address' | 'command' | 'find' | 'help' | 'sessions' | 'tabs' | 'bookmarks' | 'activity' | 'profiles' | 'settings'
type UIContext = { state: PublicState; run: (method: string, args?: Record<string, unknown>) => Promise<unknown>; show: (control: Control) => void; dismiss: () => void }

export let App = () => {
  let [state, setState] = useState<PublicState | null>(null)
  let [control, setControl] = useState<Control | null>(null)
  let [message, setMessage] = useState('')
  let run = useCallback(async (method: string, args: Record<string, unknown> = {}) => {
    try { return await bridge.command({ method, args }) }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return undefined }
  }, [])
  let show = useCallback((control: Control) => { setMessage(''); setControl(control) }, [])
  let dismiss = useCallback(() => { setControl(null); setMessage('') }, [])
  useEffect(() => {
    let previous = ''
    let accept = (next: PublicState) => {
      let { client, tab } = selection(next)
      let target = `${client?.windowId}:${client?.paneId}:${tab?.id}`
      if (previous && previous !== target) { setControl(null); setMessage('') }
      previous = target; setState(next)
    }
    let unsubscribe = bridge.subscribe(accept)
    void bridge.state().then(accept).catch(error => setMessage(String(error)))
    let controls = bridge.controls(control => { void bridge.state().then(next => { accept(next); show(control as Control) }) })
    return () => { unsubscribe(); controls() }
  }, [show])
  let prompt = control === 'address' || control === 'command' || control === 'find'
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
  let context = { state, run, show, dismiss }
  return <Context.Provider value={context}><div className={css.app}>
    <main className={css.workspace}>{window.layout ? <Branch node={window.layout} /> : <EmptyPane />}</main>
    <footer className={css.status} aria-label="Browser status">
      {control === 'address' || control === 'command' || control === 'find' ? <Prompt key={`${control}:${client.windowId}:${client.paneId}`} mode={control} message={message} onMessage={setMessage} /> : <Status message={message} />}
    </footer>
    {panel && <Panel type={panel} />}
  </div></Context.Provider>
}

let bridge = (window as unknown as { browmux: Bridge }).browmux
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
  let { state, show, run } = useUI()
  let { client, session, pane, tab, profile } = selection(state)
  let sessions = () => show('sessions')
  let address = () => show('address')
  let tabs = () => show('tabs')
  let help = () => show('help')
  let commands = () => show('command')
  let activity = () => show('activity')
  return <><button onClick={sessions} aria-label="Sessions" className={css.session}>[{session!.name}]</button>
    <div className={css.windows}>{session!.windows.map((window, index) => <StatusWindow key={window.id} id={window.id} label={`${index}:${window.name}${window.id === client!.windowId ? '*' : ''}`} active={window.id === client!.windowId} />)}</div>
    <button onClick={tabs} aria-label="Tabs" title="Tabs and active profile">{profile?.name}{pane && pane.tabs.length > 1 ? ` ${pane.tabs.findIndex(item => item.id === tab?.id) + 1}/${pane.tabs.length}` : ''}</button>
    <span className={css.drag} /><button onClick={address} aria-label="Address" className={`${css.location} ${message ? css.error : ''}`} title={message || tab?.url}>{message || state.configError || (tab && state.loading[tab.id] ? 'loading…' : '') || (tab?.url !== 'about:blank' ? tab?.url : 'Cmd+L to open a URL')}</button>
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
    if (mode === 'command' && ['help', 'sessions', 'tabs', 'bookmarks', 'activity', 'profiles', 'settings'].includes(text.trim())) { show(text.trim() as Control); return }
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

let EmptyPane = () => {
  let { show } = useUI()
  let open = () => show('address')
  return <div className={css.empty}><button onClick={open}>Cmd+L to open a URL</button></div>
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
  }, [tab.id, client!.windowId])
  let focus = () => { if (client!.paneId !== pane.id) void run('select-pane', { client: client!.id, pane: pane.id }) }
  let reload = () => { void run('reload', { tab: tab.id }) }
  let snapshot = state.snapshots[tab.id]
  return <section className={css.pane} data-focused-pane={client!.paneId === pane.id} onMouseDown={focus}><div className={css.content} ref={ref} data-browser-content data-tab-id={tab.id}>
    {state.crashes[tab.id] ? <div className={css.empty}><span>{state.crashes[tab.id]}</span><button onClick={reload}>Reload</button></div> : tab.url === 'about:blank' ? <EmptyPane /> : snapshot ? <img className={css.preview} src={snapshot.image} alt="Page preview" /> : <div className={css.empty}>{state.loading[tab.id] ? 'Loading…' : ''}</div>}
  </div></section>
}

let Panel = ({ type }: { type: Control }) => {
  let { state, dismiss } = useUI()
  let { pane, profile } = selection(state)
  let ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  let title = type.charAt(0).toUpperCase() + type.slice(1)
  return <div className={css.overlay}><div className={css.panel} role="dialog" aria-label={title} tabIndex={-1} ref={ref}>
    <header><strong>{title}</strong><button onClick={dismiss}>Close</button></header>
    {type === 'help' && <HelpContent />}
    {type === 'settings' && <KeyboardSettings />}
    {type === 'sessions' && state.model.sessions.map(session => <SessionRow key={session.id} id={session.id} name={session.name} />)}
    {type === 'tabs' && <><p>{profile?.name}</p>{pane?.tabs.map((tab, index) => <TabRow key={tab.id} id={tab.id} label={`${index}: ${tab.title}`} url={tab.url} active={tab.id === pane.activeTabId} />)}</>}
    {type === 'profiles' && <>{state.model.profiles.map(profile => <div key={profile.id} className={css.row}>{profile.name}{profile.background ? ' (background)' : ''}</div>)}<p>Use <code>new-session -s NAME --profile PROFILE</code> or <code>split-window --profile PROFILE</code>.</p></>}
    {type === 'bookmarks' && <><p>Profile: {profile?.name ?? 'No selected pane'}</p>{profile?.bookmarks?.length ? profile.bookmarks.map(bookmark => <BookmarkRow key={bookmark.id} bookmark={bookmark} />) : <p>No bookmarks in this profile.</p>}</>}
    {type === 'activity' && <><p>Permissions</p>{state.permissions.length ? state.permissions.map(permission => <PermissionRow key={permission.id} permission={permission} />) : <p>No pending requests.</p>}<p>Downloads</p>{state.downloads.map(download => <DownloadRow key={download.id} download={download} />)}</>}
  </div></div>
}
let SessionRow = ({ id, name }: { id: string; name: string }) => {
  let { state, run, dismiss } = useUI()
  let select = async () => { if (await run('switch-client', { client: state.clientId, session: id })) dismiss() }
  return <button className={css.row} onClick={select}>{name}</button>
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
  return <><dl>{bindings.map(([key, action]) => <div key={key}><dt>{key}</dt><dd>{action}</dd></div>)}</dl><p>Commands use the current session, window, pane, and tab unless you provide a target. Quote names containing spaces. Window and tab indices start at 0.</p><pre>{'open example.com\nnew-session -s work --profile professional\nsession personal\nnew-window -n research\nselect-window -t 1\nsplit-window -h --profile bot\nnext-pane\ntab new https://example.com\ntab select -t 0\nsave-layout work\nrestore-layout work --confirm\nrename-window -n reading\nkill-pane --confirm\nprofile create project --background\nprofiles / sessions / tabs / bookmarks / activity\nback / forward / reload / zoom 110\nnew-client / detach\nimport-brave\nprefix b'}</pre><p>Drag the blank area of the status bar to move this macOS window.</p></>
}

let KeyboardSettings = () => {
  let { state, run } = useUI()
  let keyboard = state.keyboard ?? DEFAULT_KEYBOARD
  let edit = () => { void run('settings.open') }
  let reload = () => { void run('settings.reload') }
  return <><p>{state.configPath}</p><p>Changes reload automatically. Set a binding to null to disable it. Invalid edits keep the last working configuration.</p>{state.configError && <p className={css.error}>{state.configError}</p>}<p>Prefix: {keyboard.prefix}</p><pre>{'keyboard:\n  prefix: Ctrl+B\n  shortcuts:\n    Cmd+R: reload\n    Cmd+,: settings\n  prefixBindings:\n    ":": command'}</pre><button onClick={edit}>Edit config</button><button onClick={reload}>Reload config</button></>
}
