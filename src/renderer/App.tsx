import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, ChangeEvent, PointerEvent, ReactNode } from 'react'
import type { Bridge, Command, InternalWindow, Layout, Pane, PublicState, Tab, Download, Permission, Bookmark } from '../shared/types'
import css from './App.module.css'

declare global { type WindowWithBridge = Window & { browmux: Bridge } }
type Field = { name: string; label: string; value?: string; options?: { value: string; label: string }[] }
type Action = { title: string; method: string; args: Record<string, unknown>; fields?: Field[]; description?: string }
type UIContext = {
  state: PublicState; run: (method: string, args?: Record<string, unknown>) => Promise<unknown>
  open: (action: Action) => void; error: string; setError: (error: string) => void
}

export let App = () => {
  let [state, setState] = useState<PublicState | null>(null)
  let [error, setError] = useState('')
  let [action, setAction] = useState<Action | null>(null)
  let [panel, setPanel] = useState<'activity' | 'help' | 'bookmarks' | null>(null)
  useEffect(() => {
    let unsubscribe = bridge.subscribe(setState)
    void bridge.state().then(setState).catch(error => setError(String(error)))
    return unsubscribe
  }, [])
  let run = useCallback(async (method: string, args: Record<string, unknown> = {}) => {
    try { return await bridge.command({ method, args }) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return undefined }
  }, [])
  let open = useCallback((action: Action) => setAction(action), [])
  let dismiss = useCallback(() => { setAction(null); setPanel(null) }, [])
  let openActivity = useCallback(() => setPanel('activity'), [])
  let openBookmarks = useCallback(() => setPanel('bookmarks'), [])
  let openHelp = useCallback(() => setPanel('help'), [])
  let clearError = useCallback(() => setError(''), [])
  useEffect(() => {
    if (!state?.clientId) return
    void bridge.command({ method: 'client.overlay', args: { client: state.clientId, visible: !!action || !!panel } })
  }, [action, panel, state?.clientId])
  if (!state) return <div className={css.empty}>{error || 'Starting Browmux…'}</div>
  let client = state.model.clients.find(client => client.id === state.clientId)
  let session = state.model.sessions.find(session => session.id === client?.sessionId)
  let currentWindow = session?.windows.find(window => window.id === client?.windowId)
  if (!client || !session || !currentWindow) return <div className={css.empty}>Attaching client…</div>
  let context = { state, run, open, error, setError }
  return (
    <Context.Provider value={context}>
      <div className={css.app}>
        <div className={css.titlebar}>
          <span className={css.brand}>Browmux</span><span className={css.eyebrow}>session</span>
          <SessionSwitcher />
          <span className={css.grow} />
          <button className={css.small} onClick={openBookmarks}>Bookmarks</button>
          <button className={css.small} onClick={openActivity}>Activity {state.permissions.length > 0 ? `(${state.permissions.length})` : ''}</button>
          <button className={css.small} onClick={openHelp}>Help</button>
        </div>
        <Toolbar />
        {error && <div className={css.error}><span className={css.grow}>{error}</span><button className={css.small} onClick={clearError}>Dismiss</button></div>}
        <main className={css.workspace}>
          {currentWindow.layout ? <Branch node={currentWindow.layout} /> : <EmptyWindow />}
        </main>
        <footer className={css.status}>
          <span>{client.id}</span><span>{session.name} / {currentWindow.name}</span><span className={css.grow} />
          <span>{state.focusedClientId === client.id ? 'live' : 'snapshot'}</span><span>Ctrl+B: sessions · windows · panes</span>
        </footer>
        {action && <ActionDialog action={action} dismiss={dismiss} />}
        {panel && <Panel type={panel} dismiss={dismiss} />}
      </div>
    </Context.Provider>
  )
}

let bridge = (window as unknown as WindowWithBridge).browmux
let Context = createContext<UIContext | null>(null)
let useUI = () => useContext(Context)!

let SessionSwitcher = () => {
  let { state, run, open } = useUI()
  let client = state.model.clients.find(client => client.id === state.clientId)!
  let switchSession = (event: ChangeEvent<HTMLSelectElement>) => { void run('switch-client', { client: client.id, session: event.target.value }) }
  let createSession = () => open({ title: 'New session', method: 'new-session', args: {}, fields: [{ name: 'name', label: 'Name' }, { name: 'profile', label: 'Default profile', value: 'profile_default', options: state.model.profiles.map(profile => ({ value: profile.id, label: profile.name })) }] })
  let createProfile = () => open({ title: 'New profile', method: 'profile.create', args: {}, description: 'Profiles keep separate logins and site storage. All tabs in a pane use its profile.', fields: [{ name: 'name', label: 'Name' }, { name: 'background', label: 'Background execution', value: 'false', options: [{ value: 'false', label: 'Normal — throttle inactive pages' }, { value: 'true', label: 'Bot — keep pages running' }] }] })
  let attach = () => { void run('attach-session', { session: client.sessionId }) }
  return <><select aria-label="Session" data-session-switcher value={client.sessionId} onChange={switchSession}>{state.model.sessions.map(session => <option key={session.id} value={session.id}>{session.name}</option>)}</select><button className={css.small} onClick={createSession}>+ Session</button><button className={css.small} onClick={createProfile}>+ Profile</button><button className={css.small} onClick={attach}>New client</button></>
}

let Toolbar = () => {
  let { state, run, open } = useUI()
  let client = state.model.clients.find(client => client.id === state.clientId)!
  let session = state.model.sessions.find(session => session.id === client.sessionId)!
  let currentWindow = session.windows.find(window => window.id === client.windowId)!
  let create = () => open({ title: 'New window', method: 'new-window', args: { session: session.id, client: client.id }, fields: [{ name: 'name', label: 'Name', value: `window-${session.windows.length + 1}` }] })
  let rename = () => open({ title: 'Rename window', method: 'rename-window', args: { window: currentWindow.id }, fields: [{ name: 'name', label: 'Name', value: currentWindow.name }] })
  let saveLayout = () => open({ title: 'Save layout', method: 'save-layout', args: { window: currentWindow.id }, fields: [{ name: 'name', label: 'Layout name', value: currentWindow.name }], description: 'Saves the split layout, profiles, and tab URLs. Saving an existing name updates it.' })
  let restoreLayout = () => open({ title: 'Restore layout', method: 'restore-layout', args: { window: currentWindow.id, confirm: true }, fields: [{ name: 'name', label: 'Saved layout', options: state.model.layouts.map(layout => ({ label: layout.name, value: layout.name })) }], description: 'Replaces the pages in this window. Unsaved page content will be lost.' })
  let close = () => open({ title: 'Close window?', method: 'kill-window', args: { window: currentWindow.id, confirm: true }, description: `Closes ${currentWindow.panes.reduce((sum, pane) => sum + pane.tabs.length, 0)} tabs in this internal window for every attached client.` })
  let paneOptions = () => open({ title: 'Split pane', method: 'split-window', args: { pane: client.paneId, window: currentWindow.id, client: client.id }, fields: [{ name: 'profile', label: 'Profile', value: currentWindow.panes.find(pane => pane.id === client.paneId)?.profileId ?? session.defaultProfileId, options: state.model.profiles.map(profile => ({ label: profile.name, value: profile.id })) }, { name: 'axis', label: 'Direction', value: 'horizontal', options: [{ label: 'Side by side', value: 'horizontal' }, { label: 'Above and below', value: 'vertical' }] }] })
  let detach = () => { void run('detach-client', { client: client.id }) }
  return <div className={css.toolbar}><span className={css.eyebrow}>windows</span><div className={css.windows}>{session.windows.map(window => <WindowButton key={window.id} window={window} />)}</div><button className={css.small} onClick={create}>+ Window</button><button className={css.small} onClick={paneOptions}>Split</button><button className={css.small} onClick={rename}>Rename</button><button className={css.small} onClick={saveLayout}>Save</button><button className={css.small} disabled={!state.model.layouts.length} onClick={restoreLayout}>Restore</button><button className={css.small} onClick={close}>Close</button><button className={css.small} onClick={detach}>Detach</button></div>
}
let WindowButton = ({ window }: { window: InternalWindow }) => {
  let { state, run } = useUI()
  let client = state.model.clients.find(client => client.id === state.clientId)!
  let select = () => { void run('select-window', { client: client.id, window: window.id }) }
  return <button className={css.windowButton} data-active={client.windowId === window.id} onClick={select} title={window.id}>{window.name}</button>
}
let EmptyWindow = () => {
  let { state, run } = useUI()
  let client = state.model.clients.find(client => client.id === state.clientId)!
  let add = () => { void run('split-window', { window: client.windowId, client: client.id }) }
  return <div className={css.empty}><strong>This window has no panes</strong><button onClick={add}>Create browser pane</button></div>
}
let Branch = ({ node }: { node: Layout }) => {
  let { state, run } = useUI()
  let ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (node.kind === 'split') ref.current?.style.setProperty('--ratio', String(node.ratio)) }, [node])
  let startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (node.kind !== 'split' || !ref.current) return
    event.preventDefault()
    let client = state.model.clients.find(client => client.id === state.clientId)!
    let bounds = ref.current.getBoundingClientRect()
    let ratio = node.ratio
    let gutter = event.currentTarget
    gutter.setPointerCapture(event.pointerId)
    void run('client.overlay', { client: client.id, visible: true })
    let move = (event: globalThis.PointerEvent) => {
      ratio = Math.max(.1, Math.min(.9, node.axis === 'horizontal' ? (event.clientX - bounds.x) / bounds.width : (event.clientY - bounds.y) / bounds.height))
      ref.current?.style.setProperty('--ratio', String(ratio))
    }
    let end = () => {
      gutter.removeEventListener('pointermove', move)
      gutter.removeEventListener('pointerup', end)
      gutter.removeEventListener('pointercancel', end)
      void run('resize-pane', { window: client.windowId, split: node.id, ratio }).then(() => run('client.overlay', { client: client.id, visible: false }))
    }
    gutter.addEventListener('pointermove', move)
    gutter.addEventListener('pointerup', end)
    gutter.addEventListener('pointercancel', end)
  }
  if (node.kind === 'pane') return <BrowserPane paneId={node.paneId} />
  return <div ref={ref} className={css.branch} data-axis={node.axis}><div className={css.first}><Branch node={node.first} /></div><div className={css.gutter} role="separator" aria-label="Resize split" onPointerDown={startDrag} /><div className={css.second}><Branch node={node.second} /></div></div>
}

let BrowserPane = ({ paneId }: { paneId: string }) => {
  let { state, run, open } = useUI()
  let pane = state.model.sessions.flatMap(session => session.windows.flatMap(window => window.panes)).find(pane => pane.id === paneId)!
  let tab = pane.tabs.find(tab => tab.id === pane.activeTabId)!
  let profile = state.model.profiles.find(profile => profile.id === pane.profileId)!
  let client = state.model.clients.find(client => client.id === state.clientId)!
  let ref = useRef<HTMLDivElement>(null)
  let [address, setAddress] = useState(tab.url === 'about:blank' ? '' : tab.url)
  let [find, setFind] = useState('')
  useEffect(() => { setAddress(tab.url === 'about:blank' ? '' : tab.url) }, [tab.url, tab.id])
  useLayoutEffect(() => {
    let publishBounds = () => {
      let bounds = [...document.querySelectorAll<HTMLElement>('[data-browser-content]')].map(element => { let rect = element.getBoundingClientRect(); return { tabId: element.dataset.tabId!, x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
      bridge.bounds(bounds)
    }
    let observer = new ResizeObserver(publishBounds)
    if (ref.current) observer.observe(ref.current)
    publishBounds()
    return () => observer.disconnect()
  }, [tab.id, client.windowId])
  let focus = () => { if (client.paneId !== pane.id) void run('select-pane', { client: client.id, pane: pane.id }) }
  let changeAddress = (event: ChangeEvent<HTMLInputElement>) => setAddress(event.target.value)
  let navigate = (event: FormEvent) => { event.preventDefault(); if (address.trim()) void run('navigate', { tab: tab.id, url: address }) }
  let back = () => { void run('back', { tab: tab.id }) }
  let forward = () => { void run('forward', { tab: tab.id }) }
  let reload = () => { void run('reload', { tab: tab.id }) }
  let addTab = () => { void run('tab.create', { pane: pane.id, client: client.id }) }
  let split = () => { void run('split-window', { pane: pane.id, client: client.id }) }
  let close = () => open({ title: 'Close pane?', method: 'kill-pane', args: { pane: pane.id, confirm: true }, description: `Closes ${pane.tabs.length} tab(s) using profile ${profile.name}.` })
  let move = () => open({ title: 'Move pane', method: 'move-pane', args: { pane: pane.id }, fields: [{ name: 'window', label: 'Destination', options: state.model.sessions.flatMap(session => session.windows.filter(window => !window.panes.some(item => item.id === pane.id)).map(window => ({ value: window.id, label: `${session.name} / ${window.name}` }))) }] })
  let findText = (event: ChangeEvent<HTMLInputElement>) => { setFind(event.target.value); void run('find', { tab: tab.id, text: event.target.value }) }
  let findNext = () => { void run('find', { tab: tab.id, text: find, next: true }) }
  let zoomOut = () => { void run('zoom', { tab: tab.id, factor: tab.zoom - .1 }) }
  let zoomIn = () => { void run('zoom', { tab: tab.id, factor: tab.zoom + .1 }) }
  let inspect = () => { void run('devtools', { tab: tab.id }) }
  let snapshot = state.snapshots[tab.id]
  return (
    <section className={css.pane} data-pane-id={pane.id} data-focused-pane={client.paneId === pane.id} onMouseDown={focus}>
      <div className={css.paneHeader}><span className={`${css.profile} ${profile.background ? css.bot : ''}`} title={profile.background ? 'Background profile: pages keep running' : 'Normal profile'}>{profile.name}</span><span className={css.paneId}>{pane.id.slice(-8)}</span><span className={css.grow} /><button className={css.small} onClick={split} title="Split right">Split</button><button className={css.small} onClick={move}>Move</button><button className={css.small} onClick={close}>x</button></div>
      <div className={css.tabs}>{pane.tabs.map(item => <TabButton key={item.id} tab={item} pane={pane} />)}<button className={css.small} onClick={addTab} title="New tab">+</button></div>
      <div className={css.navigation}><button className={css.small} onClick={back} title="Back">&lt;</button><button className={css.small} onClick={forward} title="Forward">&gt;</button><button className={css.small} onClick={reload} title="Reload">R</button><form className={css.address} onSubmit={navigate}><input data-address aria-label="Address" value={address} onChange={changeAddress} placeholder="URL or search" spellCheck={false} /></form></div>
      <div className={css.content} ref={ref} data-browser-content data-tab-id={tab.id}>
        {state.crashes[tab.id] ? <div className={css.placeholder}><strong>Page unavailable</strong><span>{state.crashes[tab.id]}</span><button onClick={reload}>Reload page</button></div> : snapshot ? <img className={css.preview} src={snapshot.image} alt="Captured page preview" /> : <div className={css.placeholder}><strong>{tab.url === 'about:blank' ? 'A fresh page' : 'Page stays alive in your session'}</strong><span>{tab.url === 'about:blank' ? 'Enter a URL above to begin.' : 'Focus this client to interact.'}</span></div>}
      </div>
      <div className={css.find}><input data-find aria-label="Find in page" placeholder="Find in page" value={find} onChange={findText} /><button className={css.small} onClick={findNext}>Next</button><button className={css.small} onClick={zoomOut}>−</button><span className={css.paneId}>{Math.round(tab.zoom * 100)}%</span><button className={css.small} onClick={zoomIn}>+</button><button className={css.small} onClick={inspect}>Inspect</button></div>
    </section>
  )
}
let TabButton = ({ tab, pane }: { tab: Tab; pane: Pane }) => {
  let { run } = useUI()
  let select = () => { void run('tab.select', { tab: tab.id }) }
  let close = () => { void run('tab.close', { tab: tab.id }) }
  return <div className={css.tab} data-active={pane.activeTabId === tab.id}><button className={css.tabTitle} onClick={select} title={`${tab.title}\n${tab.id}`}>{tab.title}</button><button className={css.tabClose} onClick={close} title="Close tab">x</button></div>
}
let FieldInput = ({ field, onChange }: { field: Field; onChange: (name: string, value: string) => void }) => {
  let change = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange(field.name, event.target.value)
  return <label className={css.field}>{field.label}{field.options ? <select name={field.name} defaultValue={field.value ?? field.options[0]?.value} onChange={change} required>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input name={field.name} defaultValue={field.value ?? ''} onChange={change} required autoFocus />}</label>
}
let ActionDialog = ({ action, dismiss }: { action: Action; dismiss: () => void }) => {
  let { run, state } = useUI()
  let [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries((action.fields ?? []).map(field => [field.name, field.value ?? field.options?.[0]?.value ?? ''])))
  let [busy, setBusy] = useState(false)
  let change = (name: string, value: string) => setValues(values => ({ ...values, [name]: name === 'background' ? value === 'true' : value }))
  let submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    let args = { ...action.args, ...values }
    if ('background' in args) args.background = args.background === true || args.background === 'true'
    let result = await run(action.method, args)
    if (result !== undefined) {
      if (action.method === 'new-session') await run('switch-client', { client: state.clientId, session: (result as { id: string }).id })
      dismiss()
    }
    setBusy(false)
  }
  return <div className={css.overlay}><form className={css.dialog} onSubmit={submit}><h2>{action.title}</h2>{action.description && <p className={css.muted}>{action.description}</p>}{action.fields?.map(field => <FieldInput key={field.name} field={field} onChange={change} />)}<div className={css.actions}><button type="button" onClick={dismiss}>Cancel</button><button type="submit" className={css.primary} disabled={busy}>{busy ? 'Working…' : 'Continue'}</button></div></form></div>
}
let PermissionRow = ({ permission }: { permission: Permission }) => {
  let { run, state } = useUI()
  let allow = () => { void run('permission.respond', { id: permission.id, allow: true }) }
  let deny = () => { void run('permission.respond', { id: permission.id, allow: false }) }
  let profile = state.model.profiles.find(profile => profile.id === permission.profileId)
  return <div className={css.listItem}><strong>{permission.permission}</strong><p className={css.muted}>{permission.origin} · {profile?.name}</p><div className={css.listActions}><button onClick={deny}>Deny</button><button onClick={allow}>Allow</button></div></div>
}
let DownloadRow = ({ download }: { download: Download }) => {
  let { run } = useUI()
  let reveal = () => { void run('download.reveal', { id: download.id }) }
  return <div className={css.listItem}><strong>{download.name}</strong><p className={css.muted}>{download.state} · {Math.round(download.received / 1024)} KB</p><button className={css.small} onClick={reveal}>Show in Finder</button></div>
}
let Panel = ({ type, dismiss }: { type: 'activity' | 'help' | 'bookmarks'; dismiss: () => void }) => {
  let { state, open } = useUI()
  let prefix = () => { dismiss(); open({ title: 'Keyboard prefix', method: 'settings.prefix', args: {}, fields: [{ name: 'key', label: 'Letter to use with Control', value: 'b' }] }) }
  let renameProfile = () => { dismiss(); open({ title: 'Rename profile', method: 'profile.rename', args: {}, fields: [{ name: 'profile', label: 'Profile', options: state.model.profiles.map(profile => ({ value: profile.id, label: profile.name })) }, { name: 'name', label: 'New name' }] }) }
  let renameSession = () => { dismiss(); let client = state.model.clients.find(client => client.id === state.clientId)!; open({ title: 'Rename session', method: 'rename-session', args: { session: client.sessionId }, fields: [{ name: 'name', label: 'New name' }] }) }
  let content: ReactNode = <><p className={css.muted}>A session contains windows. Windows hold pane layouts. Each pane has one profile and its own tabs. Native macOS windows are clients; each can select a different internal window.</p><p className={css.muted}>Ctrl+B then: c new window · n/p next/previous window · % split right · &quot; split below · o next pane · s session switcher · d detach.</p><p className={css.muted}>Cmd+L address · Cmd+T new tab · Cmd+R reload · Cmd+F find. Closing a client keeps pages alive. Quit stops the server.</p><p className={css.muted}>Inactive clients show snapshots. Bot pages keep running in the background. Use brmux --help for automation commands.</p><div className={css.listActions}><button onClick={prefix}>Keyboard prefix</button><button onClick={renameProfile}>Rename profile</button><button onClick={renameSession}>Rename session</button></div></>
  if (type === 'activity') content = <><p className={css.eyebrow}>Permissions</p>{state.permissions.length ? state.permissions.map(permission => <PermissionRow key={permission.id} permission={permission} />) : <p className={css.muted}>No pending requests.</p>}<p className={css.eyebrow}>Downloads</p>{state.downloads.length ? state.downloads.map(download => <DownloadRow key={download.id} download={download} />) : <p className={css.muted}>No downloads yet.</p>}</>
  if (type === 'bookmarks') content = <Bookmarks dismiss={dismiss} />
  return <div className={css.overlay}><div className={css.dialog}><h2>{type === 'activity' ? 'Activity' : type === 'bookmarks' ? 'Bookmarks' : 'Working in Browmux'}</h2>{content}<div className={css.actions}><button onClick={dismiss}>Close</button></div></div></div>
}

let Bookmarks = ({ dismiss }: { dismiss: () => void }) => {
  let { state, open } = useUI()
  let client = state.model.clients.find(client => client.id === state.clientId)!
  let pane = state.model.sessions.flatMap(session => session.windows.flatMap(window => window.panes)).find(pane => pane.id === client.paneId)
  let profile = state.model.profiles.find(profile => profile.id === pane?.profileId)
  let importProfiles = () => { dismiss(); open({ title: 'Import Brave profiles', method: 'import-brave', args: {}, description: 'Copies profile names and bookmark folders into separate Browmux profiles and sessions. Repeating the import refreshes their bookmarks. Website logins, passwords, extensions, and browser settings are not copied.' }) }
  return <><p className={css.muted}>{profile ? `Profile: ${profile.name}` : 'Select a browser pane to open bookmarks.'}</p>{profile?.bookmarks?.length ? <div className={css.bookmarkTree}>{profile.bookmarks.map(bookmark => <BookmarkRow key={bookmark.id} bookmark={bookmark} dismiss={dismiss} />)}</div> : <p className={css.muted}>No bookmarks in this profile.</p>}<div className={css.listActions}><button onClick={importProfiles}>Import Brave profiles</button></div></>
}
let BookmarkRow = ({ bookmark, dismiss }: { bookmark: Bookmark; dismiss: () => void }) => {
  let { state, run } = useUI()
  let client = state.model.clients.find(client => client.id === state.clientId)!
  let supported = !!bookmark.url && /^(https?:|file:)/i.test(bookmark.url)
  let activate = async () => {
    if (!supported || !client.paneId) return
    let result = await run('tab.create', { pane: client.paneId, url: bookmark.url, client: client.id })
    if (result) dismiss()
  }
  if (bookmark.children) return <details className={css.bookmarkFolder} open><summary>{bookmark.title || 'Untitled folder'}</summary><div className={css.bookmarkTree}>{bookmark.children.map(child => <BookmarkRow key={child.id} bookmark={child} dismiss={dismiss} />)}</div></details>
  return <button className={css.bookmarkLink} disabled={!supported} onClick={activate} title={supported ? bookmark.url : 'This bookmark uses a URL type Browmux cannot open'}>{bookmark.title || bookmark.url}</button>
}
