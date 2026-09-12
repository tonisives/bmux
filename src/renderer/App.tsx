import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent, PointerEvent, MouseEvent } from 'react'
import type { Bookmark, Bridge, Download, Layout, Permission, PublicState } from '../shared/types'
import css from './App.module.css'
import { DEFAULT_KEYBOARD } from '../shared/keyboard'
import { commandEntries, fuzzyMatch, HELP_NOTES, literalCommand, PANEL_COMMANDS, searchCommands } from '../shared/command-search'
import type { CommandEntry } from '../shared/command-search'
import { searchBookmarks } from '../shared/picker-search'

type ManagementControl = 'rename-window' | 'rename-session' | 'close-window'
type Control = ManagementControl | 'address' | 'command' | 'find' | 'help' | 'sessions' | 'tabs' | 'bookmarks' | 'activity' | 'profiles' | 'settings' | 'plugins' | 'plugin-dialog' | 'browser-tools'
type UIContext = { state: PublicState; control: Control | null; message: string; onMessage: (message: string) => void; run: (method: string, args?: Record<string, unknown>) => Promise<unknown>; show: (control: Control, paneId?: string) => void; dismiss: () => void }

export let App = () => {
  let [state, setState] = useState<PublicState | null>(null)
  let [control, setControl] = useState<Control | null>(null)
  let [message, setMessage] = useState('')
  let previous = useRef('')
  let previousControl = useRef<Control | null>(null)
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
    if (!state?.clientId) return
    let restoreFocus = ['tabs', 'sessions', 'bookmarks', 'find'].includes(previousControl.current ?? '')
    previousControl.current = control
    let cancelled = false
    // Child layout effects publish the selected tab's bounds before it receives focus.
    void run('client.overlay', { client: state.clientId, visible: !!panel || control === 'command' }).then(() => {
      if (!cancelled && !control && restoreFocus) void run('focus-page', { client: state.clientId })
    })
    return () => { cancelled = true }
  }, [panel, control, state?.clientId, run])
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
      {control === 'rename-window' || control === 'rename-session' || control === 'close-window' ? <ManagementPrompt key={`${control}:${client.windowId}`} mode={control} message={message} /> : control === 'command' ? <CommandPrompt key={`${client.windowId}:${client.paneId}`} /> : control === 'find' ? <FindPrompt key={`${client.windowId}:${client.paneId}`} /> : <Status message={control === 'address' ? '' : message} />}
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
  let { state, show, control } = useUI()
  let { client, session, pane, tab, profile } = selection(state)
  let sessions = () => show('sessions')
  let tabs = () => show('tabs')
  let help = () => show('help')
  let commands = () => show('command')
  let activity = () => show('activity')
  return <><button onClick={sessions} aria-label="Sessions" className={css.session}>[{session!.name}]</button>
    <div className={css.windows}>{session!.windows.map((window, index) => <StatusWindow key={window.id} id={window.id} label={`${index}:${window.name}${window.id === client!.windowId ? '*' : ''}`} active={window.id === client!.windowId} />)}</div>
    <button onClick={tabs} aria-label="Tabs" title="Active browser profile and tabs">profile:{profile?.name}{pane && pane.tabs.length > 1 ? ` ${pane.tabs.findIndex(item => item.id === tab?.id) + 1}/${pane.tabs.length}` : ''}</button>
    <span className={css.drag} />{(message || state.configError || state.bitwardenMessage) && <span className={message || state.configError ? css.error : css.notice} title={message || state.configError || state.bitwardenMessage || undefined}>{message || state.configError || state.bitwardenMessage}</span>}
    {!control && state.passwordSuggestions && <PasswordSuggestions />}
    {state.permissions.length > 0 && <button onClick={activity} aria-label="Activity">permission:{state.permissions.length}</button>}
    <button onClick={commands} aria-label="Command prompt">:</button><button onClick={help} aria-label="Help" title="Ctrl+B then ?">?</button>
  </>
}
let PasswordSuggestions = () => {
  let { state, run } = useUI()
  let suggestions = state.passwordSuggestions!
  let choose = async (event: MouseEvent<HTMLButtonElement>) => {
    let id = event.currentTarget.dataset.loginId
    if (await run('bitwarden.select', { id }) !== undefined) void run('focus-page', { client: state.clientId })
  }
  return <div className={css.passwordSuggestions} role="group" aria-label="Bitwarden logins" title={`Logins for ${suggestions.origin}`}>
    <span>passwords:</span>{suggestions.items.map(item => <button key={item.id} data-login-id={item.id} onClick={choose} title={item.name} aria-label={`Fill login ${item.username || item.name}`}>{item.username || item.name}</button>)}
  </div>
}
let StatusWindow = ({ id, label, active }: { id: string; label: string; active: boolean }) => {
  let { state, run } = useUI()
  let select = () => { void run('select-window', { client: state.clientId, window: id }) }
  return <button onClick={select} data-active={active}>{label}</button>
}

let commandHistory: string[] = []
let MatchText = ({ value, query }: { value: string; query: string }) => {
  let positions = new Set(query.trim().split(/\s+/).flatMap(term => fuzzyMatch(term, value)?.positions ?? []))
  let parts: { start: number; value: string; matched: boolean }[] = []
  for (let index = 0; index < value.length; index++) {
    let matched = positions.has(index), previous = parts.at(-1)
    if (previous?.matched === matched) previous.value += value[index]
    else parts.push({ start: index, value: value[index], matched })
  }
  return <>{parts.map(part => part.matched ? <mark key={part.start}>{part.value}</mark> : <span key={part.start}>{part.value}</span>)}</>
}
let CommandOption = ({ entry, position, active, query, busy, choose }: { entry: CommandEntry; position: number; active: boolean; query: string; busy: boolean; choose: (event: MouseEvent<HTMLButtonElement>) => void }) => (
  <button id={`command-result-${position}`} type="button" role="option" aria-selected={active} tabIndex={-1} className={css.commandOption} data-command={entry.command} onClick={choose} disabled={busy}><span className={css.commandName}><MatchText value={entry.usage ?? entry.command} query={query} /></span><span className={css.commandDescription}><MatchText value={entry.description} query={query} /></span><span className={css.commandKeys}>{entry.shortcuts?.join(' · ')}</span></button>
)

let CommandPrompt = () => {
  let { state, run, show, dismiss, message } = useUI()
  let [text, setText] = useState(''), [index, setIndex] = useState(0), [selected, setSelected] = useState(false), [busy, setBusy] = useState(false)
  let input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null), mounted = useRef(true)
  let historyIndex = useRef(commandHistory.length), draft = useRef('')
  let entries = commandEntries(state.keyboard ?? DEFAULT_KEYBOARD, state.plugins)
  let literal = literalCommand(text), argumentsStarted = literal && /\S\s/.test(text.trimStart())
  let query = argumentsStarted ? text.trim().split(/\s+/)[0] : text
  let results = searchCommands(entries, query, commandHistory).slice(0, 80)
  let active = results[Math.min(index, Math.max(0, results.length - 1))]
  useEffect(() => { input.current?.focus(); mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [index, text])
  let finish = () => { dismiss(); void run('client.overlay', { client: state.clientId, visible: false }).then(() => run('focus-page', { client: state.clientId })) }
  let edit = (line: string) => { setText(line); setIndex(0); setSelected(false); input.current?.focus() }
  let complete = (line: string) => { historyIndex.current = commandHistory.length; edit(line) }
  let change = (event: ChangeEvent<HTMLInputElement>) => { draft.current = event.target.value; historyIndex.current = commandHistory.length; edit(event.target.value) }
  let remember = (line: string) => { if (commandHistory.at(-1) !== line) commandHistory.push(line); commandHistory = commandHistory.slice(-100) }
  let execute = async (line: string, entry?: CommandEntry) => {
    if (busy) return
    if (entry?.complete) { complete(entry.command); return }
    if (!line.trim()) return
    let exact = entries.find(item => item.command === line.trim())
    if (exact?.control) { remember(line); show(exact.control); return }
    if (PANEL_COMMANDS.some(panel => panel === line.trim())) { remember(line); show(line.trim() as Control); return }
    setBusy(true); remember(line)
    let result = await run('command-line', { client: state.clientId, line })
    if (!mounted.current) return
    setBusy(false)
    if (result !== undefined) finish()
  }
  let submit = (event: FormEvent) => {
    event.preventDefault()
    if (active && (selected || !literal || (!argumentsStarted && active.complete))) void execute(active.command, active)
    else void execute(text)
  }
  let choose = (event: MouseEvent<HTMLButtonElement>) => {
    let entry = results.find(item => item.command === event.currentTarget.dataset.command)
    if (entry) void execute(entry.command, entry)
  }
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); return }
    if (busy) return
    if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); void execute(text); return }
    let key = event.key.toLowerCase()
    if (event.ctrlKey && ['r', 's'].includes(key)) {
      event.preventDefault()
      if (historyIndex.current === commandHistory.length) { if (key === 's') return; draft.current = text }
      historyIndex.current = Math.max(0, Math.min(commandHistory.length, historyIndex.current + (key === 'r' ? -1 : 1)))
      edit(commandHistory[historyIndex.current] ?? draft.current); return
    }
    if (event.key === 'Tab' && active) { event.preventDefault(); complete(active.command); return }
    if (['ArrowUp', 'ArrowDown'].includes(event.key) || (event.ctrlKey && ['p', 'n'].includes(key))) {
      event.preventDefault(); setSelected(true)
      let direction = event.key === 'ArrowUp' || key === 'p' ? -1 : 1
      setIndex(Math.max(0, Math.min(results.length - 1, index + direction)))
    }
  }
  return <><form className={css.prompt} onSubmit={submit}><label htmlFor="command">:</label><input id="command" ref={input} aria-label="Command" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-results" aria-activedescendant={active ? `command-result-${results.indexOf(active)}` : undefined} value={text} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} readOnly={busy} /><span className={message ? css.error : undefined} role="status">{message || (busy ? 'running…' : 'esc')}</span><button type="submit" className={css.submit} aria-label="Submit">Enter</button></form>
    <section className={css.commandFinder} aria-label="Command finder"><div className={css.finderHint}>Type to find · ↑/↓ or Ctrl+P/N select · Tab complete · Enter {argumentsStarted && !selected ? 'run typed command' : 'open / run'} · Ctrl+R history</div>
      <div ref={list} id="command-results" role="listbox" aria-label="Commands" className={css.commandResults}>{results.map((entry, position) => <CommandOption key={entry.command} entry={entry} position={position} active={entry === active} query={query} busy={busy} choose={choose} />)}</div>
      {!results.length && <p className={css.finderHint}>No matching commands. Enter runs the text you typed.</p>}
    </section></>
}

let AddressPrompt = () => {
  let { state, run, dismiss, message, onMessage } = useUI()
  let { client, pane, tab } = selection(state)
  let [text, setText] = useState(tab?.url !== 'about:blank' ? tab?.url ?? '' : '')
  let [busy, setBusy] = useState(false)
  let ref = useRef<HTMLInputElement>(null)
  let mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  let change = (event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)
  let submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    let target = tab?.id
    if (!target) {
      let created = await run('split-window', { window: client!.windowId, client: client!.id }) as { activeTabId: string } | undefined
      target = created?.activeTabId
    }
    let result = target ? await run('navigate', { tab: target, url: text, waitUntil: 'none' }) : undefined
    if (!mounted.current) return
    setBusy(false)
    if (result === undefined) { if (!tab && !pane) onMessage('Create a pane first'); return }
    dismiss()
    void run('focus-page', { client: client!.id })
  }
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { dismiss(); void run('focus-page', { client: client!.id }) }
  }
  return <form className={css.prompt} onSubmit={submit}><label htmlFor="prompt">open</label><input id="prompt" ref={ref} aria-label="URL or search" value={text} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} readOnly={busy} /><span className={message ? css.error : undefined} role="status">{message || (busy ? 'loading…' : 'esc')}</span><button type="submit" className={css.submit} aria-label="Submit">Enter</button></form>
}

let FindPrompt = () => {
  let { state, run, message, onMessage, dismiss } = useUI()
  let { tab } = selection(state)
  let loading = !!(tab && state.loading[tab.id])
  let [text, setText] = useState('')
  let ref = useRef<HTMLInputElement>(null)
  let timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  useEffect(() => {
    if (!tab || loading) return
    timer.current = setTimeout(() => { void run('find', { tab: tab.id, text }) }, text ? 120 : 0)
    return () => clearTimeout(timer.current)
  }, [text, tab?.id, loading, run])
  useEffect(() => () => {
    if (tab) void bridge.command({ method: 'find', args: { tab: tab.id, text: '' } }).catch(() => undefined)
  }, [tab?.id])
  let result = tab ? state.findResults?.[tab.id] : undefined
  let current = result?.text === text ? result : undefined
  let change = (event: ChangeEvent<HTMLInputElement>) => { onMessage(''); setText(event.target.value) }
  let search = (forward = true) => {
    clearTimeout(timer.current)
    if (tab && text) void run('find', { tab: tab.id, text, next: current !== undefined, forward })
    ref.current?.focus()
  }
  let next = () => search(), previous = () => search(false)
  let submit = (event: FormEvent) => { event.preventDefault(); search() }
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); search(false) }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss() }
  }
  let summary = !text ? 'Enter next · Shift+Enter previous · Esc close' : !current?.finalUpdate ? 'Searching…' : current.matches ? `${current.activeMatchOrdinal} / ${current.matches}` : 'No matches'
  return <form className={css.prompt} onSubmit={submit}><label htmlFor="find">/</label><input id="find" ref={ref} aria-label="Find in page" value={text} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} /><span className={message ? css.error : undefined} role="status" aria-label="Find results">{message || summary}</span><button type="button" onClick={previous} disabled={!text} aria-label="Previous match">Previous</button><button type="button" onClick={next} disabled={!text} aria-label="Next match">Next</button></form>
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
  let { state, control, show } = useUI()
  let { client, window } = selection(state)
  let pane = window?.panes.find(pane => pane.id === paneId)
  let tab = pane?.tabs.find(tab => tab.id === pane.activeTabId)
  let editing = control === 'address' && (client?.paneId === paneId || !paneId)
  let open = () => show('address', paneId)
  return <div className={css.addressBar} role="group" aria-label="Pane address">
    {editing ? <AddressPrompt key={tab?.id ?? 'empty'} /> : <button onClick={open} aria-label="Address" className={css.location} title={tab?.url}>{tab?.url && tab.url !== 'about:blank' ? tab.url : 'Cmd+L to open a URL'}</button>}
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
  let ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!['help', 'sessions', 'tabs', 'bookmarks', 'plugin-dialog', 'plugins'].includes(type)) ref.current?.focus() }, [type])
  let title = type === 'plugin-dialog' ? 'Plugin' : type === 'browser-tools' ? 'Browser tools' : type.charAt(0).toUpperCase() + type.slice(1)
  return <div className={css.overlay}><div className={css.panel} role="dialog" aria-label={title} tabIndex={-1} ref={ref}>
    <header><strong>{title}</strong><button onClick={dismiss}>Close</button></header>
    {type === 'help' && <HelpContent />}
    {type === 'plugins' && <PluginList />}
    {type === 'plugin-dialog' && state.pluginPrompt && <PluginDialog key={state.pluginPrompt.id} />}
    {type === 'browser-tools' && <BrowserTools />}
    {type === 'settings' && <KeyboardSettings />}
    {type === 'sessions' && <SessionPicker />}
    {type === 'tabs' && <TabPicker />}
    {type === 'profiles' && <>{state.model.profiles.map(profile => <div key={profile.id} className={css.row}>{profile.name}{profile.background ? ' (background)' : ''}</div>)}<p>Use <code>new-session -s NAME --profile PROFILE</code> or <code>split-window --profile PROFILE</code>.</p></>}
    {type === 'bookmarks' && <BookmarkPicker />}
    {type === 'activity' && <><PluginActivity /><p>Permissions</p>{state.permissions.length ? state.permissions.map(permission => <PermissionRow key={permission.id} permission={permission} />) : <p>No pending requests.</p>}<p>Downloads</p>{state.downloads.map(download => <DownloadRow key={download.id} download={download} />)}</>}
  </div></div>
}
let PluginList = () => {
  let { state, run, dismiss } = useUI()
  let [query, setQuery] = useState('')
  let choose = (event: MouseEvent<HTMLButtonElement>) => { dismiss(); void run('plugin.run', { action: event.currentTarget.dataset.action }) }
  let toggle = (event: ChangeEvent<HTMLInputElement>) => { void run('plugin.enable', { id: event.target.dataset.id, enabled: event.target.checked }) }
  let reload = () => { void run('plugin.reload') }
  let change = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)
  return <><label>Find plugin action<input className={css.pluginInput} value={query} onChange={change} autoFocus /></label>
    {!state.plugins?.length && <p>No plugins found. Add folders containing plugin.yaml beside your config, in plugins/.</p>}
    {state.plugins?.map(plugin => <div key={plugin.id}><label><input type="checkbox" data-id={plugin.id} checked={plugin.enabled} onChange={toggle} />{plugin.name} · {plugin.enabled ? 'enabled' : 'disabled'}{plugin.error ? ` · ${plugin.error}` : ''}</label>
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
let usePickerNavigation = () => {
  let [query, setQuery] = useState('')
  let ref = useRef<HTMLDivElement>(null)
  let input = useRef<HTMLInputElement>(null)
  useEffect(() => { (ref.current?.querySelector<HTMLButtonElement>('[data-active="true"]') ?? input.current)?.focus() }, [])
  let change = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)
  let keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.metaKey || event.altKey || event.ctrlKey) return
    let editing = event.target === input.current
    if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); input.current?.focus(); return }
    if (event.key === '/' && !editing) { event.preventDefault(); input.current?.focus(); input.current?.select(); return }
    if (!editing && event.key.length === 1 && event.key !== ' ') { event.preventDefault(); setQuery(query + event.key); input.current?.focus(); return }
    let rows = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(row => row.getClientRects().length)
    if (editing && event.key === 'Enter') { event.preventDefault(); rows[0]?.click(); return }
    if (editing && ['Home', 'End'].includes(event.key)) return
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return
    event.preventDefault()
    let index = rows.findIndex(row => row === document.activeElement)
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index + ({ ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[event.key] ?? 0)
    let row = rows[Math.max(0, Math.min(rows.length - 1, next))]
    row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' })
  }
  return { ref, keys, input, query, change }
}
let SessionPicker = () => {
  let { state } = useUI()
  let { ref, keys, input, query, change } = usePickerNavigation()
  let sessions = state.model.sessions.filter(session => fuzzyMatch(query, session.name))
  return <div ref={ref} onKeyDown={keys} role="group" aria-label="Choose session"><label>Search sessions<input ref={input} className={css.pluginInput} value={query} onChange={change} autoComplete="off" spellCheck={false} /></label><p>Type or / to search. Up/Down to move, Enter to attach. Escape clears search, then closes.</p>{sessions.map(session => <SessionRow key={session.id} id={session.id} name={session.name} />)}{!sessions.length && <p role="status">No matching sessions.</p>}</div>
}
let SessionRow = ({ id, name }: { id: string; name: string }) => {
  let { state, run, dismiss } = useUI()
  let active = selection(state).client?.sessionId === id
  let select = async () => { if (await run('switch-client', { client: state.clientId, session: id }) && active) dismiss() }
  return <button className={css.row} onClick={select} data-active={active} aria-current={active ? 'true' : undefined}>{name}</button>
}
let TabPicker = () => {
  let { state } = useUI()
  let { pane, profile } = selection(state)
  let { ref, keys, input, query, change } = usePickerNavigation()
  let tabs = pane?.tabs.map((tab, index) => ({ tab, index })).filter(({ tab }) => fuzzyMatch(query, `${tab.title} ${tab.url}`)) ?? []
  return <div ref={ref} onKeyDown={keys} role="group" aria-label="Choose tab"><p>Profile: {profile?.name}</p><label>Search tabs<input ref={input} className={css.pluginInput} value={query} onChange={change} placeholder="Title or URL" autoComplete="off" spellCheck={false} /></label><p>Type or / to search. Up/Down to move, Enter to select. Escape clears search, then closes.</p>{tabs.map(({ tab, index }) => <TabRow key={tab.id} id={tab.id} label={`${index}: ${tab.title}`} url={tab.url} active={tab.id === pane!.activeTabId} />)}{!tabs.length && <p role="status">No matching tabs.</p>}</div>
}
let TabRow = ({ id, label, url, active }: { id: string; label: string; url: string; active: boolean }) => {
  let { run, dismiss } = useUI()
  // A changed selection closes the picker when App receives the new state and bounds.
  let select = async () => { if (await run('tab.select', { tab: id }) && active) dismiss() }
  return <button className={css.row} onClick={select} title={url} data-active={active} aria-current={active ? 'true' : undefined}>{label}{active ? ' *' : ''}<span className={css.pluginDescription}>{url}</span></button>
}
let BookmarkPicker = () => {
  let { state } = useUI()
  let { profile } = selection(state)
  let { ref, keys, input, query, change } = usePickerNavigation()
  let bookmarks = searchBookmarks(profile?.bookmarks ?? [], query)
  return <div ref={ref} onKeyDown={keys} role="group" aria-label="Choose bookmark"><p>Profile: {profile?.name ?? 'No selected pane'}</p><label>Search bookmarks<input ref={input} className={css.pluginInput} value={query} onChange={change} placeholder="Title, URL, or folder" autoComplete="off" spellCheck={false} /></label><p>Up/Down to move, Enter to open. Escape clears search, then closes.</p>{bookmarks.map(bookmark => <BookmarkRow key={`${query}:${bookmark.id}`} bookmark={bookmark} />)}{!bookmarks.length && <p role="status">{query ? 'No matching bookmarks.' : 'No bookmarks in this profile.'}</p>}</div>
}
let BookmarkRow = ({ bookmark }: { bookmark: Bookmark }) => {
  let { state, run } = useUI()
  let { client } = selection(state)
  let supported = !!bookmark.url && /^(https?:|file:)/i.test(bookmark.url)
  let activate = () => { if (supported && client?.paneId) void run('tab.create', { pane: client.paneId, url: bookmark.url, client: client.id }) }
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

let HelpRow = ({ label, description, query }: { label: string; description: string; query: string }) => <div><dt><MatchText value={label} query={query} /></dt><dd><MatchText value={description} query={query} /></dd></div>
let HelpContent = () => {
  let { state } = useUI()
  let [query, setQuery] = useState(''), [searching, setSearching] = useState(false)
  let root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null)
  useEffect(() => { root.current?.focus() }, [])
  useEffect(() => { if (searching) input.current?.focus() }, [searching])
  let keyboard = state.keyboard ?? DEFAULT_KEYBOARD
  let entries = commandEntries(keyboard, state.plugins)
  let bindings = [...Object.entries(keyboard.shortcuts), ...Object.entries(keyboard.prefixBindings).map(([key, action]) => [`${keyboard.prefix} then ${key}`, action])].map(([key, action]) => ({ key, action, description: entries.find(entry => entry.action === action)?.description ?? '' })).filter(binding => fuzzyMatch(query, `${binding.key} ${binding.action} ${binding.description}`))
  let commands = searchCommands(entries, query), notes = HELP_NOTES.filter(note => fuzzyMatch(query, note))
  let change = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)
  useEffect(() => {
    let keys = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && event.target !== input.current) { event.preventDefault(); setSearching(true); input.current?.focus(); input.current?.select() }
      if (event.key === 'Escape' && searching) { event.preventDefault(); event.stopPropagation(); setSearching(false); setQuery(''); root.current?.focus() }
      if (event.key === 'Enter' && event.target === input.current) { event.preventDefault(); root.current?.focus() }
    }
    document.addEventListener('keydown', keys, true)
    return () => document.removeEventListener('keydown', keys, true)
  }, [searching])
  return <div ref={root} tabIndex={-1} className={css.helpContent}>
    <div className={css.helpSearch}>{searching ? <label>Search help<input ref={input} className={css.pluginInput} aria-label="Search help" value={query} onChange={change} autoComplete="off" spellCheck={false} placeholder="Commands, keys, or descriptions" /></label> : <p>Press / to search commands and shortcuts.</p>}<span role="status">{query ? `${bindings.length + commands.length + notes.length} matches · Esc clears search` : 'Esc closes help'}</span></div>
    {!!bindings.length && <><h2>Shortcuts</h2><dl>{bindings.map(binding => <HelpRow key={binding.key} label={binding.key} description={binding.action} query={query} />)}</dl></>}
    {!!commands.length && <><h2>Commands</h2><dl className={css.helpCommands}>{commands.map(entry => <HelpRow key={entry.command} label={entry.usage ?? entry.command} description={entry.description} query={query} />)}</dl></>}
    {notes.map(note => <p key={note}>{note}</p>)}
    {!bindings.length && !commands.length && !notes.length && <p>No matching help entries.</p>}
  </div>
}

let BrowserTools = () => {
  let { state, run, show } = useUI()
  let { tab, profile } = selection(state)
  let tools = state.browserTools, current = tab && tools?.tabs[tab.id]
  let [scope, setScope] = useState('site')
  let settings = scope === 'global' ? tools?.defaults : scope === 'profile' ? current?.profileDefaults : current
  let changeScope = (event: ChangeEvent<HTMLSelectElement>) => setScope(event.target.value)
  let adblock = () => { void run('browser.set', { tab: tab?.id, setting: 'adblock', value: !settings?.adblock, scope }) }
  let dark = (event: ChangeEvent<HTMLSelectElement>) => { void run('browser.set', { tab: tab?.id, setting: 'darkMode', value: event.target.value, scope }) }
  let inherit = async () => { await run('browser.set', { tab: tab?.id, setting: 'adblock', value: 'inherit', scope }); await run('browser.set', { tab: tab?.id, setting: 'darkMode', value: 'inherit', scope }) }
  let update = () => { void run('browser.update-filters') }
  let reload = () => { void run('browser.reload-scripts') }
  let edit = () => { void run('settings.open') }
  let plugins = () => show('plugins')
  let toggleScript = (event: ChangeEvent<HTMLInputElement>) => { void run('browser.script', { id: event.target.dataset.id, enabled: event.target.checked }) }
  return <><p>{profile?.name} · {current?.origin || 'Open a website to change its settings'}</p>
    <div className={css.toolOptions}><label>Apply changes to<select value={scope} onChange={changeScope}><option value="site">This site in this profile</option><option value="profile">This profile</option><option value="global">All profiles</option></select></label>
      <button onClick={adblock} disabled={!tab || (scope === 'site' && !current?.origin)} aria-pressed={settings?.adblock}>Ad and tracker blocking: {settings?.adblock ? 'on' : 'off'}</button>
      <label>Website dark mode<select value={settings?.darkMode ?? 'off'} onChange={dark} disabled={!tab || (scope === 'site' && !current?.origin)}><option value="off">Off</option><option value="dark">Dark Reader</option><option value="system">Follow system</option></select></label>
      <button onClick={inherit} disabled={!tab || (scope === 'site' && !current?.origin)}>Reset to inherited settings</button>
    </div>
    {scope !== 'site' && <p>Existing site overrides still apply. This page: blocking {current?.adblock ? 'on' : 'off'}, dark mode {current?.darkMode ?? 'off'}.</p>}
    {current?.error && <p className={css.error}>{current.error}</p>}
    <p>{current?.blocked ?? 0} requests blocked on this page. Reload to retry blocked resources.</p>
    {!!current?.recent.length && <details><summary>Blocked requests</summary>{current.recent.map((request, index) => <div className={css.row} key={`${request.time}:${index}`}>{request.host} · {request.type}</div>)}</details>}
    <p>{tools?.filters.network ?? 0} network rules. Filters updated {tools?.filters.updatedAt ? new Date(tools.filters.updatedAt).toLocaleDateString() : 'never'}.</p>
    {tools?.filters.error && <p className={css.error}>{tools.filters.error}</p>}
    <button onClick={update} disabled={tools?.filters.updating}>{tools?.filters.updating ? 'Updating filters…' : 'Update filters'}</button>
    <p>Userscripts and styles</p>
    {tools?.scripts.length ? tools.scripts.map(script => <label className={css.row} key={script.id}><input type="checkbox" data-id={script.id} checked={script.enabled} onChange={toggleScript} />{script.name}{script.error && <span className={css.error}>{script.error}</span>}</label>) : <p>Add local .js or .css files under browser.userscripts in the config. JavaScript changes apply on the next navigation.</p>}
    <button onClick={reload}>Reload scripts</button><button onClick={edit}>Edit config</button>
    <p>Use <code>save-fill</code> to save a form, <code>fill</code> to restore it, and <code>passwords</code> for Bitwarden.</p><button onClick={plugins}>Form fills and plugins</button>
  </>
}

let KeyboardSettings = () => {
  let { state, run, show } = useUI()
  let tools = () => show('browser-tools')
  let keyboard = state.keyboard ?? DEFAULT_KEYBOARD
  let edit = () => { void run('settings.open') }
  let reload = () => { void run('settings.reload') }
  return <><button onClick={tools}>Browser tools</button><p>{state.configPath}</p><p>Changes reload automatically. Set a binding to null to disable it. Invalid edits keep the last working configuration.</p>{state.configError && <p className={css.error}>{state.configError}</p>}<p>Status bar: {state.statusBar ?? 'top'}. Set <code>statusBar: top</code> or <code>statusBar: bottom</code>.</p><p>Accessibility: {state.accessibility ? 'enabled' : 'automatic'}. Set <code>accessibility: true</code> in the config to expose page controls to oVim and other accessibility tools.</p><p>Prefix: {keyboard.prefix}</p><pre>{'statusBar: top\nkeyboard:\n  prefix: Ctrl+B\n  shortcuts:\n    Cmd+R: reload\n    Cmd+,: settings\n  prefixBindings:\n    ":": command'}</pre><button onClick={edit}>Edit config</button><button onClick={reload}>Reload config</button></>
}
