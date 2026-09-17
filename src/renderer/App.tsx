import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent, PointerEvent, MouseEvent } from 'react'
import type { Bookmark, BookmarkParameters, Bridge, Download, HistoryEntry, InternalWindow, Layout, Permission, PublicState } from '../shared/types'
import css from './App.module.css'
import { SearchInput } from './SearchInput'
import { DEFAULT_KEYBOARD, shortcutAction, shortcutLabel } from '../shared/keyboard'
import { commandEntries, fuzzyMatch, HELP_NOTES, literalCommand, PANEL_COMMANDS, searchCommands } from '../shared/command-search'
import type { CommandEntry } from '../shared/command-search'
import { searchBookmarkPages, searchBookmarks, searchHistory } from '../shared/picker-search'
import { windowCloseBehavior } from '../shared/window-close'
import { inlineUrlCompletion } from '../shared/address-suggestions'
import { deleteWordBackward } from '../shared/text-edit'
import { editableBookmarkParameters, parameterizedBookmarkUrl } from '../shared/bookmark-parameters'

type ManagementControl = 'rename-window' | 'rename-session' | 'close-pane' | 'close-window'
type Control = ManagementControl | 'address' | 'command' | 'find' | 'help' | 'sessions' | 'bookmark' | 'bookmarks' | 'history' | 'activity' | 'downloads' | 'profiles' | 'settings' | 'plugins' | 'plugin-dialog' | 'browser-tools'
type HistoryPopup = { tabId: string; direction: 'back' | 'forward' }
type UIContext = { state: PublicState; control: Control | null; historyPopup: HistoryPopup | null; setHistoryPopup: (popup: HistoryPopup | null) => void; addressFocusVersion: number; message: string; onMessage: (message: string) => void; run: (method: string, args?: Record<string, unknown>) => Promise<unknown>; show: (control: Control, paneId?: string) => void; dismiss: () => void; acknowledgeDownload: (downloadId: string) => void; acknowledgedDownloads: Set<string> }

export let App = () => {
  let [state, setState] = useState<PublicState | null>(null)
  let [control, setControl] = useState<Control | null>(null)
  let [historyPopup, setHistoryPopup] = useState<HistoryPopup | null>(null)
  let [addressFocusVersion, setAddressFocusVersion] = useState(0)
  let [message, setMessage] = useState('')
  let [acknowledgedDownloads, setAcknowledgedDownloads] = useState<Set<string>>(() => new Set())
  let previous = useRef('')
  let knownPanes = useRef<Set<string> | null>(null)
  let previousControl = useRef<Control | null>(null)
  let previousHistoryPopup = useRef(false)
  let accept = useCallback((next: PublicState) => {
    let { client, tab } = selection(next)
    let target = `${client?.windowId}:${client?.paneId}:${tab?.id}`
    if (previous.current && previous.current !== target) { setControl(null); setHistoryPopup(null); setMessage('') }
    let paneIds = next.model.sessions.flatMap(session => session.windows.flatMap(window => window.panes.map(pane => pane.id)))
    if (client?.paneId && client.id === next.focusedClientId && knownPanes.current && !knownPanes.current.has(client.paneId) && tab?.url === 'about:blank' && !tab.openerTabId) {
      setControl('address')
      void bridge.command({ method: 'focus-ui', args: { client: client.id } }).catch(error => setMessage(String(error)))
    }
    knownPanes.current = new Set(paneIds)
    if (next.pluginPrompt) setControl('plugin-dialog')
    else setControl(current => current === 'plugin-dialog' ? null : current)
    previous.current = target; setState(next)
  }, [])
  let run = useCallback(async (method: string, args: Record<string, unknown> = {}) => {
    try { return await bridge.command({ method, args }) }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return undefined }
  }, [])
  let show = useCallback(async (control: Control, paneId?: string) => {
    setHistoryPopup(null)
    if (paneId) {
      let current = await bridge.state()
      if (selection(current).pane?.id !== paneId) {
        if (await run('select-pane', { client: current.clientId, pane: paneId, focus: false }) === undefined) return
        current = await bridge.state()
      }
      accept(current)
    }
    if (control === 'address') { void run('focus-ui'); setAddressFocusVersion(version => version + 1) }
    setMessage(''); setControl(control)
  }, [accept, run])
  let dismiss = useCallback(() => {
    if (state?.pluginPrompt) void bridge.command({ method: 'plugin.respond', args: { id: state.pluginPrompt.id, cancel: true } }).catch(() => undefined)
    setControl(null); setHistoryPopup(null); setMessage('')
  }, [state?.pluginPrompt])
  let acknowledgeDownload = useCallback((downloadId: string) => setAcknowledgedDownloads(current => new Set(current).add(downloadId)), [])
  useEffect(() => {
    let unsubscribe = bridge.subscribe(accept)
    void bridge.state().then(accept).catch(error => setMessage(String(error)))
    let controls = bridge.controls(control => {
      if (control === 'dismiss') { dismiss(); return }
      void bridge.state().then(next => { accept(next); if (control !== 'plugin-dialog') show(control as Control) })
    })
    return () => { unsubscribe(); controls() }
  }, [accept, show, dismiss])
  let management = control === 'rename-window' || control === 'rename-session' || control === 'close-pane' || control === 'close-window'
  let prompt = management || control === 'address' || control === 'command' || control === 'find'
  let panel = control && !prompt ? control : null
  useEffect(() => {
    if (!state?.clientId) return
    let restoreFocus = previousHistoryPopup.current || ['sessions', 'bookmark', 'bookmarks', 'history', 'find', 'downloads', 'activity', 'profiles'].includes(previousControl.current ?? '')
    previousControl.current = control
    previousHistoryPopup.current = !!historyPopup
    let cancelled = false
    // Child layout effects publish the selected page's bounds before it receives focus.
    void run('client.overlay', { client: state.clientId, visible: !!panel || control === 'command' || !!historyPopup }).then(() => {
      if (!cancelled && !control && restoreFocus) void run('focus-page', { client: state.clientId })
    })
    return () => { cancelled = true }
  }, [panel, control, historyPopup, state?.clientId, run])
  useEffect(() => {
    let escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [dismiss])
  if (!state) return <div className={css.empty}>{message || 'Starting…'}</div>
  let { client, window } = selection(state)
  if (!client || !window) return <div className={css.empty}>Attaching…</div>
  let layout = client.zoomedPaneId && window.panes.some(pane => pane.id === client.zoomedPaneId) ? { kind: 'pane' as const, paneId: client.zoomedPaneId } : window.layout
  let context = { state, control, historyPopup, setHistoryPopup, addressFocusVersion, message, onMessage: setMessage, run, show, dismiss, acknowledgeDownload, acknowledgedDownloads }
  return <Context.Provider value={context}><div className={css.app} data-status-bar={state.statusBar ?? 'top'}>
    <main className={css.workspace}>{layout ? <Branch node={layout} /> : <section className={css.pane}><PaneAddress /><EmptyPane /></section>}</main>
    <footer className={css.status} aria-label="Browser status">
      {control === 'rename-window' || control === 'rename-session' || control === 'close-pane' || control === 'close-window' ? <ManagementPrompt key={`${control}:${client.windowId}:${client.paneId}`} mode={control} message={message} /> : control === 'command' ? <CommandPrompt key={`${client.windowId}:${client.paneId}`} /> : control === 'find' ? <FindPrompt key={`${client.windowId}:${client.paneId}`} /> : <Status message={control === 'address' ? '' : message} />}
    </footer>
    {panel && <Panel key={panel} type={panel} />}
  </div></Context.Provider>
}

const AVATAR_COLORS = ['#89a8c7', '#b891c7', '#c9907b', '#87ad91', '#c4a96a', '#789fb0']

let profileHash = (value: string) => [...value].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261)

let ProfileAvatar = ({ id, name }: { id: string; name: string }) => {
  let hash = profileHash(id), background = AVATAR_COLORS[hash % AVATAR_COLORS.length], foreground = AVATAR_COLORS[(hash >>> 5) % AVATAR_COLORS.length]
  let left = 3 + (hash % 5), top = 3 + ((hash >>> 3) % 5), radius = 4 + ((hash >>> 6) % 3)
  return <svg className={css.profileAvatar} viewBox="0 0 20 20" aria-hidden="true" data-profile-avatar={id}>
    <rect width="20" height="20" fill={background} />
    <circle cx={left} cy={top} r={radius} fill={foreground} opacity=".9" />
    <path d={`M0 ${12 + (hash % 4)} Q${8 + (hash % 5)} ${5 + ((hash >>> 8) % 5)} 20 ${11 + ((hash >>> 11) % 5)} V20 H0Z`} fill="#17202a" opacity=".45" />
    <text x="10" y="14" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="700" fontFamily="ui-monospace, monospace">{name.trim().charAt(0).toUpperCase()}</text>
  </svg>
}

let DownloadStatusIcon = ({ progressing, progress }: { progressing: boolean; progress?: number }) => progressing
  ? <svg className={`${css.statusIcon} ${progress === undefined ? css.downloadProgressIndeterminate : ''}`} viewBox="0 0 20 20" aria-hidden="true" data-download-icon="progressing" data-download-progress={progress}>
    <circle className={css.downloadProgressTrack} cx="10" cy="10" r="7" pathLength="100" />
    <circle className={css.downloadProgressValue} cx="10" cy="10" r="7" pathLength="100" strokeDasharray={progress === undefined ? undefined : `${progress} ${100 - progress}`} />
    <path d="M10 5v6m-2-2 2 2 2-2" />
  </svg>
  : <svg className={css.statusIcon} viewBox="0 0 20 20" aria-hidden="true" data-download-icon="idle"><path d="M10 2v10m-4-4 4 4 4-4M4 17h12" /></svg>

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
  let { state, show, acknowledgedDownloads } = useUI()
  let { client, session, profile } = selection(state)
  let windows = useRef<HTMLDivElement>(null)
  let sessions = () => show('sessions')
  let profiles = () => show('profiles')
  let help = () => show('help')
  let commands = () => show('command')
  let activity = () => show('activity')
  let downloads = () => show('downloads')
  let unhandledDownloads = state.downloads.filter(item => item.profileId === profile?.id && !acknowledgedDownloads.has(item.id))
  let progressingDownloads = unhandledDownloads.filter(item => item.active && item.state === 'progressing' && !item.paused)
  let progressTotal = progressingDownloads.reduce((total, item) => total + item.total, 0)
  let downloadProgress = progressingDownloads.length > 0 && progressingDownloads.every(item => item.total > 0)
    ? Math.min(100, Math.floor(progressingDownloads.reduce((received, item) => received + item.received, 0) / progressTotal * 100))
    : undefined
  let downloadTitle = progressingDownloads.length
    ? `${progressingDownloads.length} download${progressingDownloads.length === 1 ? '' : 's'} in progress${downloadProgress === undefined ? '' : ` · ${downloadProgress}%`}`
    : 'Downloads'
  useLayoutEffect(() => {
    let list = windows.current
    if (!list) return
    let reveal = () => {
      let active = list.querySelector<HTMLElement>('[data-active="true"]')
      if (!active) return
      let left = active.offsetLeft - list.offsetLeft, right = left + active.offsetWidth
      if (left < list.scrollLeft) list.scrollLeft = Math.max(0, left - 1)
      else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth + 1
    }
    let observer = new ResizeObserver(reveal)
    observer.observe(list); reveal()
    return () => observer.disconnect()
  }, [client?.windowId, session?.windows.length])
  return <><button onClick={sessions} aria-label="Sessions" className={css.session}>[{session!.name}]</button>
    <div ref={windows} className={css.windows} data-window-list>{session!.windows.map((window, index) => <StatusWindow key={window.id} window={window} index={index + 1} active={window.id === client!.windowId} />)}</div>
    <span className={css.drag} />{(message || state.configError) && <span className={css.error} title={message || state.configError || undefined}>{message || state.configError}</span>}
    <button onClick={profiles} aria-label={profile ? `Profile: ${profile.name}` : 'Profile'} title={profile ? `Profile: ${profile.name}` : 'Profile'} className={css.profileButton}>{profile && <ProfileAvatar id={profile.id} name={profile.name} />}</button>
    {state.permissions.length > 0 && <button onClick={activity} aria-label="Activity">permission:{state.permissions.length}</button>}
    {unhandledDownloads.length > 0 && <button onClick={downloads} aria-label="Downloads" title={downloadTitle} className={css.downloadButton}><DownloadStatusIcon progressing={progressingDownloads.length > 0} progress={downloadProgress} />{progressingDownloads.length > 1 && <span className={css.downloadCount}>{progressingDownloads.length}</span>}</button>}
    <button onClick={commands} aria-label="Command prompt">:</button><button onClick={help} aria-label="Help" title="Ctrl+B then ?">?</button>
  </>
}
let StatusWindow = ({ window, index, active }: { window: InternalWindow; index: number; active: boolean }) => {
  let { state, run } = useUI()
  let client = state.model.clients.find(client => client.id === state.clientId)
  let pane = window.panes.find(pane => active && pane.id === client?.paneId) ?? window.panes[0]
  let tabId = pane?.activeTabId
  let label = `${index}:${window.name}${active ? '*' : ''}`
  let select = () => { void run('select-window', { client: state.clientId, window: window.id }) }
  let close = () => { void run('kill-window', { window: window.id, confirm: true }) }
  return <span className={css.windowTab} data-window-id={window.id}>
    <button onClick={select} className={css.windowSelect} data-active={active} title={window.name}>
      {tabId && (state.loading[tabId] ? <span className={css.tabSpinner} aria-hidden="true" data-tab-loading /> : state.favicons[tabId] ? <img className={css.tabFavicon} src={state.favicons[tabId]} alt="" /> : null)}
      <span className={css.windowLabel}>{label}</span>
    </button>
    {state.showTabCloseButtons === true && <button onClick={close} className={css.windowClose} aria-label={`Close ${window.name}`} title={`Close ${window.name}`}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg></button>}
  </span>
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
    if (exact?.control) {
      remember(line)
      let { session, window } = selection(state)
      if (exact.control !== 'close-window' || !session || !window) { show(exact.control); return }
      let behavior = windowCloseBehavior(session, window)
      if (behavior === 'confirm') { show(exact.control); return }
      setBusy(true)
      let result = await run('kill-window', { client: state.clientId, window: window.id, confirm: true })
      if (!mounted.current) return
      setBusy(false)
      if (result !== undefined) finish()
      return
    }
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

let isUrlInput = (value: string) => /^[a-z][a-z\d+.-]*:/i.test(value) || /^localhost(?::\d+)?(?:\/|$)/.test(value) || /^127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(value) || (!/\s/.test(value) && value.includes('.'))

let AddressPrompt = () => {
  let { state, run, dismiss, message, onMessage, addressFocusVersion } = useUI()
  let { client, pane, tab, profile } = selection(state)
  let [index, setIndex] = useState(-1)
  let [text, setText] = useState(tab?.url !== 'about:blank' ? tab?.url ?? '' : '')
  let [query, setQuery] = useState('')
  let [searchTerms, setSearchTerms] = useState<string[]>([])
  let [inlineUrl, setInlineUrl] = useState<{ value: string; url: string }>()
  let [busy, setBusy] = useState(false)
  let ref = useRef<HTMLInputElement>(null)
  let deleting = useRef(false)
  let mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [addressFocusVersion])
  let normalized = query.trim().toLowerCase()
  let bookmarks = searchBookmarkPages(profile?.bookmarks ?? [], query).slice(0, 8)
  let bookmarkUrls = new Set(bookmarks.map(bookmark => bookmark.url))
  let history = normalized ? (profile?.history ?? []).filter(entry => !bookmarkUrls.has(entry.url) && `${entry.title} ${entry.url}`.toLowerCase().includes(normalized)).slice(0, Math.min(4, 8 - bookmarks.length)) : []
  let results = [
    ...bookmarks.map(bookmark => ({ kind: 'bookmark', value: parameterizedBookmarkUrl(bookmark.url!, state.bookmarkParameters?.[profile!.id]?.[bookmark.id]), title: bookmark.title, detail: bookmark.url! })),
    ...history.map(entry => ({ kind: 'history', value: entry.url, title: entry.title, detail: entry.url })),
    ...searchTerms.filter(term => !history.some(entry => entry.url === term)).slice(0, Math.max(0, 8 - bookmarks.length - history.length)).map(term => ({ kind: 'search', value: term, title: term, detail: 'Google Search' })),
  ]
  useEffect(() => {
    let value = query.trim()
    if (!value || value.length > 200 || isUrlInput(value)) { setSearchTerms([]); return }
    let cancelled = false
    setSearchTerms([])
    let timer = setTimeout(() => {
      void bridge.command({ method: 'search-suggestions', args: { query: value } }).then(result => {
        if (!cancelled) setSearchTerms(Array.isArray(result) ? result.filter((term): term is string => typeof term === 'string') : [])
      }).catch(() => { if (!cancelled) setSearchTerms([]) })
    }, 120)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])
  useEffect(() => { setIndex(current => Math.min(current, results.length - 1)) }, [results.length])
  useLayoutEffect(() => {
    if (!inlineUrl || !ref.current) return
    ref.current.setSelectionRange(query.length, inlineUrl.value.length)
  }, [inlineUrl, query])
  let change = (event: ChangeEvent<HTMLInputElement>) => {
    let value = event.target.value
    let deletion = deleting.current || ((event.nativeEvent as InputEvent).inputType?.startsWith('delete') ?? false)
    deleting.current = false
    let completion = deletion ? undefined : (profile?.history ?? []).map(entry => inlineUrlCompletion(value, entry.url)).find(Boolean)
    setQuery(value); setIndex(-1); setInlineUrl(completion); setText(completion?.value ?? value)
  }
  let navigate = async (url: string) => {
    if (!url.trim() || busy) return
    setBusy(true)
    let target = tab?.id
    if (!target) {
      let created = await run('split-window', { window: client!.windowId, client: client!.id }) as { activeTabId: string } | undefined
      target = created?.activeTabId
    }
    let result = target ? await run('navigate', { tab: target, url, waitUntil: 'none' }) : undefined
    if (!mounted.current) return
    setBusy(false)
    if (result === undefined) { if (!tab && !pane) onMessage('Create a pane first'); return }
    dismiss()
    void run('focus-page', { client: client!.id })
  }
  let submit = (event: FormEvent) => { event.preventDefault(); void navigate(inlineUrl?.url ?? results[index]?.value ?? text) }
  let choose = (event: MouseEvent<HTMLButtonElement>) => { void navigate(event.currentTarget.dataset.value!) }
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'w') {
      event.preventDefault()
      let input = event.currentTarget
      let deletion = deleteWordBackward(input.value, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length)
      deleting.current = true
      input.setSelectionRange(deletion.cursor, input.selectionEnd ?? input.value.length)
      document.execCommand('delete')
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') deleting.current = true
    if (event.key === 'ArrowRight' && inlineUrl && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.currentTarget.selectionStart === query.length && event.currentTarget.selectionEnd === text.length) {
      event.preventDefault(); setQuery(text); setInlineUrl(undefined); requestAnimationFrame(() => ref.current?.setSelectionRange(text.length, text.length)); return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex(current => Math.max(-1, Math.min(results.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))))
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); void run('focus-page', { client: client!.id }) }
  }
  return <div className={css.addressEditor}><form className={css.prompt} onSubmit={submit}><label htmlFor="prompt">open</label><div className={css.addressInput}><input id="prompt" ref={ref} aria-label="URL or search" aria-autocomplete="both" aria-expanded={!!results.length} aria-controls="address-suggestions" aria-activedescendant={results[index] ? `address-suggestion-${index}` : undefined} value={text} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} readOnly={busy} /></div><span className={message ? css.error : undefined} role="status">{message || (busy ? 'loading…' : inlineUrl ? 'Enter opens · Backspace searches · esc' : 'esc')}</span><button type="submit" className={css.submit} aria-label="Submit">Enter</button></form>
    {!!results.length && <div id="address-suggestions" role="listbox" aria-label="Address suggestions" className={css.urlHistory}>{results.map((entry, position) => <button key={`${entry.kind}:${entry.value}`} id={`address-suggestion-${position}`} type="button" role="option" aria-selected={position === index} data-kind={entry.kind} data-value={entry.value} onClick={choose} disabled={busy}><AddressSuggestionIcon kind={entry.kind} /><strong>{entry.title}</strong><span>{entry.detail}</span></button>)}</div>}
  </div>
}

let AddressSuggestionIcon = ({ kind }: { kind: string }) => <svg className={css.addressSuggestionIcon} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
  {kind === 'bookmark' ? <path d="M4 2.5h8v11l-4-2.7-4 2.7z" /> : kind === 'history' ? <><circle cx="8" cy="8" r="5.5" /><path d="M8 4.5V8l2.5 1.5" /></> : <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></>}
</svg>

let FindPrompt = () => {
  let { state, run, message, onMessage, dismiss } = useUI()
  let { tab } = selection(state)
  let loading = !!(tab && state.loading[tab.id])
  let [text, setText] = useState('')
  let result = tab ? state.findResults?.[tab.id] : undefined
  let current = result?.text === text ? result : undefined
  let searching = !!current
  let ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  useEffect(() => {
    if (!tab || loading || searching) return
    void run('find', { tab: tab.id, text })
  }, [text, tab?.id, loading, searching, run])
  useEffect(() => () => {
    if (tab) void bridge.command({ method: 'find', args: { tab: tab.id, text: '' } }).catch(() => undefined)
  }, [tab?.id])
  let change = (event: ChangeEvent<HTMLInputElement>) => { onMessage(''); setText(event.target.value) }
  let search = (forward = true) => {
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
  let summary = !text ? 'Enter next · Shift+Enter previous · Esc close' : current?.matches ? `${current.activeMatchOrdinal || 1} / ${current.matches}${current.finalUpdate ? '' : '…'}` : current?.finalUpdate ? 'No matches' : 'Searching…'
  return <form className={css.prompt} onSubmit={submit}><label htmlFor="find">/</label><input id="find" ref={ref} aria-label="Find in page" value={text} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} /><span className={message ? css.error : undefined} role="status" aria-label="Find results">{message || summary}</span><button type="button" onClick={previous} disabled={!text} aria-label="Previous match">Previous</button><button type="button" onClick={next} disabled={!text} aria-label="Next match">Next</button></form>
}

let ManagementPrompt = ({ mode, message }: { mode: ManagementControl; message: string }) => {
  let { state, run, dismiss } = useUI()
  let { client, session, window, pane } = selection(state)
  let closingPane = mode === 'close-pane', closingWindow = mode === 'close-window', closing = closingPane || closingWindow
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
    let result = await run(closingPane ? 'kill-pane' : closingWindow ? 'kill-window' : mode, { client: client!.id, window: window!.id, pane: pane?.id, session: session!.id, ...(closing ? { confirm: true } : { name: text.trim() }) })
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
  let label = closingPane ? 'Close pane? (y/n)' : closingWindow ? `Close window "${window!.name}"? (y/n)` : mode === 'rename-session' ? 'Rename session' : 'Rename window'
  return <form className={css.prompt} onSubmit={submit}><label htmlFor="manage">{label}</label><input id="manage" ref={ref} aria-label={closingPane ? 'Close pane confirmation' : closingWindow ? 'Close window confirmation' : label} value={text} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} readOnly={busy} /><span className={message ? css.error : undefined} role="status">{message || 'esc'}</span><button type="submit" className={css.submit} aria-label="Submit">Enter</button></form>
}

let EmptyPane = ({ paneId }: { paneId?: string }) => {
  let { show } = useUI()
  let open = () => show('address', paneId)
  return <div className={css.empty}><button onClick={open}>Cmd+L to open a URL</button></div>
}
let NavigationButton = ({ direction, tabId, enabled, hasHistory, open }: { direction: 'back' | 'forward'; tabId: string; enabled: boolean; hasHistory: boolean; open: () => void }) => {
  let { run } = useUI()
  let timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  let held = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])
  let cancelHold = () => { clearTimeout(timer.current); timer.current = undefined }
  let press = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !hasHistory) return
    held.current = false
    timer.current = setTimeout(() => { held.current = true; open() }, 450)
  }
  let click = () => { if (held.current) { held.current = false; return }; void run(direction, { tab: tabId }) }
  let contextMenu = (event: MouseEvent<HTMLButtonElement>) => { if (!hasHistory) return; event.preventDefault(); cancelHold(); held.current = true; open() }
  return <button type="button" className={css.navigationButton} aria-label={direction === 'back' ? 'Back' : 'Forward'} title={direction === 'back' ? 'Back (hold for history)' : 'Forward (hold for history)'} disabled={!enabled} onPointerDown={press} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold} onClick={click} onContextMenu={contextMenu}><svg viewBox="0 0 16 16" aria-hidden="true"><path d={direction === 'back' ? 'M10.5 3.5 6 8l4.5 4.5' : 'M5.5 3.5 10 8l-4.5 4.5'} /></svg></button>
}
let NavigationMenuItem = ({ entry, select }: { entry: { index: number; title: string; url: string }; select: (index: number) => void }) => {
  let click = () => select(entry.index)
  return <button type="button" role="menuitem" onClick={click} title={entry.url}><strong>{entry.title || entry.url}</strong><span>{entry.url}</span></button>
}
let PaneAddress = ({ paneId }: { paneId?: string }) => {
  let { state, control, show, run, historyPopup, setHistoryPopup } = useUI()
  let { client, window } = selection(state)
  let pane = window?.panes.find(pane => pane.id === paneId)
  let tab = pane?.tabs.find(tab => tab.id === pane.activeTabId)
  let url = tab ? state.pendingUrls[tab.id] ?? tab.url : undefined
  let editing = control === 'address' && (client?.paneId === paneId || !paneId)
  let open = () => show('address', paneId)
  let navigation = tab ? state.navigation[tab.id] : undefined
  let activeIndex = navigation?.activeIndex ?? 0
  let entries = navigation?.entries ?? []
  let back = entries.map((entry, index) => ({ ...entry, index })).filter(entry => entry.index < activeIndex).reverse()
  let forward = entries.map((entry, index) => ({ ...entry, index })).filter(entry => entry.index > activeIndex)
  let backHasPage = back.length > 0 && back[0].url !== 'about:blank'
  let backEnabled = back.length > 0 ? backHasPage : !!tab?.openerTabId && !!pane?.tabs.some(candidate => candidate.id === tab.openerTabId)
  let popup = historyPopup?.tabId === tab?.id ? historyPopup : null
  let menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!popup) return
    let outside = (event: globalThis.PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setHistoryPopup(null) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [popup, setHistoryPopup])
  let selectHistory = (index: number) => { if (!tab) return; setHistoryPopup(null); void run('history.go-to', { tab: tab.id, index }) }
  let refresh = () => { if (tab) void run('reload', { tab: tab.id }) }
  return <div className={css.addressBar} role="group" aria-label="Pane address">
    {tab && <div className={css.navigationControls}>
      <NavigationButton direction="back" tabId={tab.id} enabled={backEnabled} hasHistory={backHasPage} open={() => setHistoryPopup({ tabId: tab.id, direction: 'back' })} />
      <NavigationButton direction="forward" tabId={tab.id} enabled={forward.length > 0} hasHistory={forward.length > 0} open={() => setHistoryPopup({ tabId: tab.id, direction: 'forward' })} />
      <button type="button" className={css.navigationButton} aria-label="Refresh" title="Refresh" onClick={refresh}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 7.5a5 5 0 1 0-.9 3.3M13 3.5v4h-4" /></svg></button>
      {popup && <div ref={menu} className={css.navigationMenu} role="menu" aria-label={`${popup.direction === 'back' ? 'Back' : 'Forward'} history`}>
        {(popup.direction === 'back' ? back : forward).map(entry => <NavigationMenuItem key={entry.index} entry={entry} select={selectHistory} />)}
      </div>}
    </div>}
    {editing ? <AddressPrompt key={tab?.id ?? 'empty'} /> : <button onClick={open} aria-label="Address" className={css.location} title={url}>{url && url !== 'about:blank' ? url : 'Cmd+L to open a URL'}</button>}
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
  useEffect(() => { if (!['help', 'sessions', 'bookmark', 'bookmarks', 'history', 'plugin-dialog', 'plugins'].includes(type)) ref.current?.focus() }, [type])
  let title = type === 'plugin-dialog' ? 'Plugin' : type === 'browser-tools' ? 'Browser tools' : type === 'profiles' ? 'Profile' : type.charAt(0).toUpperCase() + type.slice(1)
  return <div className={css.overlay}><div className={css.panel} role="dialog" aria-label={title} tabIndex={-1} ref={ref}>
    <header><strong>{title}</strong><button onClick={dismiss}>Close</button></header>
    {type === 'help' && <HelpContent />}
    {type === 'plugins' && <PluginList />}
    {type === 'plugin-dialog' && state.pluginPrompt && <PluginDialog key={state.pluginPrompt.id} />}
    {type === 'browser-tools' && <BrowserTools />}
    {type === 'settings' && <KeyboardSettings />}
    {type === 'sessions' && <SessionPicker />}
    {type === 'profiles' && <ProfileInfo />}
    {type === 'bookmark' && <BookmarkEditor />}
    {type === 'bookmarks' && <BookmarkPicker />}
    {type === 'history' && <HistoryPicker />}
    {type === 'downloads' && <DownloadManager />}
    {type === 'activity' && <><PluginActivity /><p>Permissions</p>{state.permissions.length ? state.permissions.map(permission => <PermissionRow key={permission.id} permission={permission} />) : <p>No pending requests.</p>}<DownloadManager /></>}
  </div></div>
}
let PluginList = () => {
  let { state, run, dismiss } = useUI()
  let [query, setQuery] = useState('')
  let choose = (event: MouseEvent<HTMLButtonElement>) => { dismiss(); void run('plugin.run', { action: event.currentTarget.dataset.action }) }
  let toggle = (event: ChangeEvent<HTMLInputElement>) => { void run('plugin.enable', { id: event.target.dataset.id, enabled: event.target.checked }) }
  let reload = () => { void run('plugin.reload') }
  let change = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)
  return <><ToolStatus /><h2>Installed plugins</h2><SearchInput aria-label="Find plugin action" value={query} onChange={change} autoFocus />
    {!state.plugins?.length && <p>No plugins found. Add folders containing plugin.yaml beside your config, in plugins/.</p>}
    {state.plugins?.map(plugin => <div key={plugin.id}><label><input type="checkbox" data-id={plugin.id} checked={plugin.enabled} onChange={toggle} />{plugin.name} · {plugin.enabled ? 'enabled' : 'disabled'}{plugin.error ? ` · ${plugin.error}` : ''}</label>
      {plugin.actions.filter(action => `${plugin.name} ${action.title}`.toLowerCase().includes(query.toLowerCase())).map(action => <button key={action.id} className={css.listRow} disabled={!plugin.enabled} data-action={`${plugin.id}/${action.id}`} onClick={choose}>{action.title}{action.description && <span className={css.pluginDescription}>{action.description}</span>}</button>)}</div>)}
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
    {request.kind === 'pick' ? <SearchInput ref={ref} aria-label={request.title} value={value} onChange={change} onKeyDown={keys} /> : <label>{request.title}<input ref={ref} className={css.pluginInput} type={request.kind === 'password' ? 'password' : 'text'} value={value} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} required={request.required} /></label>}
    {request.kind === 'pick' ? items.map((item, position) => <button key={item.id} type="button" className={css.listRow} data-id={item.id} data-active={position === index} disabled={busy} onClick={pick}>{item.label}{item.description && <span className={css.pluginDescription}>{item.description}</span>}</button>) : <button type="submit" disabled={busy}>Continue</button>}
    {request.kind === 'pick' && !items.length && <p>No matching items.</p>}
  </form>}</>
}
let usePickerNavigation = (onMetaEnter?: (row: HTMLButtonElement) => void) => {
  let [query, setQuery] = useState('')
  let ref = useRef<HTMLDivElement>(null)
  let input = useRef<HTMLInputElement>(null)
  useEffect(() => { (ref.current?.querySelector<HTMLButtonElement>('[data-active="true"]') ?? input.current)?.focus() }, [])
  useEffect(() => {
    let rows = ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([data-picker-action])')
    rows?.forEach((row, index) => { row.dataset.searchSelected = String(!!query && index === 0) })
  }, [query])
  let change = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)
  let keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.altKey) return
    if (event.target instanceof HTMLElement && event.target !== input.current && event.target.closest('input, [data-picker-action]')) return
    let editing = event.target === input.current
    let rows = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([data-picker-action])')].filter(row => row.getClientRects().length)
    if (event.key === 'Enter' && event.metaKey && onMetaEnter) {
      event.preventDefault()
      let selected = rows.find(row => row === document.activeElement) ?? rows[0]
      if (selected) onMetaEnter(selected)
      return
    }
    if (event.metaKey || event.ctrlKey) return
    if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); input.current?.focus(); return }
    if (event.key === '/' && !editing) { event.preventDefault(); input.current?.focus(); input.current?.select(); return }
    if (!editing && event.key.length === 1 && event.key !== ' ') { event.preventDefault(); setQuery(query + event.key); input.current?.focus(); return }
    if (editing && event.key === 'Enter') { event.preventDefault(); rows[0]?.click(); return }
    if (editing && ['Home', 'End'].includes(event.key)) return
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return
    event.preventDefault()
    let index = rows.findIndex(row => row === document.activeElement)
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index + ({ ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[event.key] ?? 0)
    let nextIndex = Math.max(0, Math.min(rows.length - 1, next)), row = rows[nextIndex]
    row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' })
    let panel = ref.current?.closest<HTMLElement>('[role="dialog"]')
    if (event.key === 'ArrowUp' && nextIndex === 0 && panel) panel.scrollTop = 0
    if (event.key === 'ArrowDown' && nextIndex === rows.length - 1 && panel) panel.scrollTop = panel.scrollHeight
  }
  return { ref, keys, input, query, setQuery, change }
}
let SessionPicker = () => {
  let { state, run } = useUI()
  let [creating, setCreating] = useState(false), [name, setName] = useState(''), [busy, setBusy] = useState(false)
  let { ref, keys, input, query, change } = usePickerNavigation()
  let client = selection(state).client
  let previousSession = state.model.sessions.find(session => session.id === client?.sessionHistory?.find(id => id !== client.sessionId))
  let backSession = previousSession && fuzzyMatch(query, `go back ${previousSession.name}`) ? previousSession : undefined
  let sessions = state.model.sessions.filter(session => fuzzyMatch(query, session.name))
  let goBack = () => { if (client && previousSession) void run('switch-client', { client: client.id, session: previousSession.id }) }
  let begin = () => setCreating(true)
  let cancel = () => { setCreating(false); setName('') }
  let changeName = (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)
  let creationKeys = (event: KeyboardEvent<HTMLFormElement>) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); cancel() } }
  let create = async (event: FormEvent) => {
    event.preventDefault()
    let sessionName = name.trim()
    if (!sessionName || busy) return
    setBusy(true)
    if (await run('new-session', { name: sessionName, client: state.clientId }) === undefined) setBusy(false)
  }
  return <div ref={ref} onKeyDown={keys} role="group" aria-label="Choose session"><SearchInput ref={input} aria-label="Search sessions" value={query} onChange={change} />{backSession && <button className={`${css.listRow} ${css.sessionBack}`} data-session-back onClick={goBack}>go back: {backSession.name}</button>}{sessions.map(session => <SessionRow key={session.id} id={session.id} name={session.name} />)}{!backSession && !sessions.length && <p role="status">No matching sessions.</p>}{creating ? <form className={css.sessionCreate} onSubmit={create} onKeyDown={creationKeys}><label>Session name<input className={css.pluginInput} value={name} onChange={changeName} autoFocus autoComplete="off" spellCheck={false} required /></label><div><button type="submit" disabled={busy}>Create session</button><button type="button" onClick={cancel} disabled={busy}>Cancel</button></div></form> : <button className={`${css.listRow} ${css.newSession}`} onClick={begin}>new session</button>}</div>
}
let SessionRow = ({ id, name }: { id: string; name: string }) => {
  let { state, run, dismiss } = useUI()
  let [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false)
  let active = selection(state).client?.sessionId === id
  let select = async () => { if (await run('switch-client', { client: state.clientId, session: id }) && active) dismiss() }
  let ask = () => setConfirming(true)
  let cancel = () => setConfirming(false)
  let close = async () => {
    if (busy) return
    setBusy(true)
    if (await run('kill-session', { session: id, confirm: true }) === undefined) setBusy(false)
  }
  if (confirming) return <div className={css.sessionConfirm} role="alertdialog" aria-label={`Close session ${name}?`}><span>Close session "{name}"?</span><button data-picker-action onClick={close} disabled={busy}>yes</button><button data-picker-action onClick={cancel} disabled={busy}>no</button></div>
  return <div className={css.sessionRow}><button className={css.listRow} data-session-row onClick={select} data-active={active} aria-current={active ? 'true' : undefined}>{name}</button><button className={css.sessionClose} data-picker-action onClick={ask} aria-label={`Close session ${name}`}>x</button></div>
}
let ProfileInfo = () => {
  let { state } = useUI()
  let { session, window, pane, profile } = selection(state)
  if (!profile) return <p>No profile is selected.</p>
  return <section className={css.profileInfo} aria-label={`${profile.name} profile details`}>
    <div className={css.profileHeading}><ProfileAvatar id={profile.id} name={profile.name} /><strong>{profile.name}</strong></div>
    <dl>
      <div><dt>Background pages</dt><dd>{profile.background ? 'Keep running' : 'Throttle when inactive'}</dd></div>
      <div><dt>Session</dt><dd>{session?.name}</dd></div>
      <div><dt>Window</dt><dd>{window?.name}</dd></div>
      <div><dt>Pane</dt><dd>{pane?.id}</dd></div>
    </dl>
    <p>Cookies, site storage, cache, permissions, bookmarks, and history are isolated to this profile.</p>
  </section>
}
type BookmarkFolderOption = { id: string; label: string }
let bookmarkFolderOptions = (bookmarks: Bookmark[], ancestors: string[] = []): BookmarkFolderOption[] => bookmarks.flatMap(bookmark => {
  if (!bookmark.children) return []
  let path = [...ancestors, bookmark.title || 'Untitled folder']
  return [{ id: bookmark.id, label: path.join(' / ') }, ...bookmarkFolderOptions(bookmark.children, path)]
})
let bookmarkFolderForUrl = (bookmarks: Bookmark[], url: string, folderId = ''): string | undefined => {
  for (let bookmark of bookmarks) {
    if (bookmark.url === url) return folderId
    if (bookmark.children) {
      let nested = bookmarkFolderForUrl(bookmark.children, url, bookmark.id)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}
let BookmarkEditor = () => {
  let { state, run, dismiss } = useUI()
  let { tab, profile } = selection(state)
  let folders = bookmarkFolderOptions(profile?.bookmarks ?? [])
  let [title, setTitle] = useState(tab?.title && tab.title !== 'about:blank' ? tab.title : ''), [folder, setFolder] = useState(() => bookmarkFolderForUrl(profile?.bookmarks ?? [], tab?.url ?? '') ?? '')
  let [busy, setBusy] = useState(false), [creatingFolder, setCreatingFolder] = useState(false), [folderName, setFolderName] = useState(''), [folderBusy, setFolderBusy] = useState(false)
  let input = useRef<HTMLInputElement>(null)
  let folderNameInput = useRef<HTMLInputElement>(null)
  let { ref: folderPicker, keys: folderKeys, input: folderSearch, query: folderQuery, setQuery: setFolderQuery, change: changeFolderQuery } = usePickerNavigation()
  let folderOptions = [{ id: '', label: 'Profile root' }, ...folders]
  let matchingFolders = folderOptions.filter(option => fuzzyMatch(folderQuery, option.label))
  let selectedFolder = folderOptions.find(option => option.id === folder)?.label ?? 'Profile root'
  let supported = !!tab && /^(https?:|file:)/i.test(tab.url)
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  useEffect(() => { if (creatingFolder) folderNameInput.current?.focus() }, [creatingFolder])
  let changeTitle = (event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)
  let chooseFolder = (event: MouseEvent<HTMLButtonElement>) => setFolder(event.currentTarget.dataset.id ?? '')
  let beginFolder = () => { setFolderName(''); setCreatingFolder(true) }
  let cancelFolder = () => { setFolderName(''); setCreatingFolder(false); folderSearch.current?.focus() }
  let changeFolderName = (event: ChangeEvent<HTMLInputElement>) => setFolderName(event.target.value)
  let createFolder = async () => {
    if (!tab || !folderName.trim() || folderBusy) return
    setFolderBusy(true)
    let result = await run('bookmark.folder.add', { tab: tab.id, title: folderName, parent: folder }) as { folder: Bookmark } | undefined
    setFolderBusy(false)
    if (!result) return
    setFolder(result.folder.id); setFolderQuery(''); setFolderName(''); setCreatingFolder(false)
  }
  let folderNameKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); void createFolder() }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelFolder() }
  }
  let editorKeys = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== '/' || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    let titleSelected = event.target === input.current && input.current?.selectionStart === 0 && input.current.selectionEnd === title.length
    if (!titleSelected && event.target instanceof HTMLInputElement) return
    event.preventDefault(); folderSearch.current?.focus(); folderSearch.current?.select()
  }
  let submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!tab || !supported || !title.trim() || busy) return
    setBusy(true)
    let result = await run('bookmark.add', { tab: tab.id, title, folder })
    setBusy(false)
    if (result !== undefined) dismiss()
  }
  if (!profile || !tab) return <p>No page is selected.</p>
  return <form className={css.bookmarkEditor} onSubmit={submit} onKeyDown={editorKeys}>
    <p className={css.bookmarkUrl}>{tab.url}</p>
    <label>Title<input ref={input} value={title} onChange={changeTitle} autoComplete="off" spellCheck={false} required /></label>
    <div ref={folderPicker} className={css.bookmarkFolders} onKeyDown={folderKeys} role="group" aria-label="Choose bookmark folder">
      <label>Folder search<SearchInput ref={folderSearch} aria-label="Search bookmark folders" value={folderQuery} onChange={changeFolderQuery} /></label>
      <div className={css.bookmarkFolderRows}>{matchingFolders.map(option => <button key={option.id || 'root'} type="button" className={css.listRow} data-bookmark-folder data-id={option.id} data-active={folder === option.id} aria-pressed={folder === option.id} onClick={chooseFolder}>{option.label}</button>)}</div>
      {!matchingFolders.length && <p role="status">No matching folders.</p>}
      {creatingFolder ? <div className={css.newBookmarkFolder}><label>New folder name<input ref={folderNameInput} value={folderName} onChange={changeFolderName} onKeyDown={folderNameKeys} autoComplete="off" spellCheck={false} /></label><div><button type="button" data-picker-action onClick={createFolder} disabled={!folderName.trim() || folderBusy}>{folderBusy ? 'Creating…' : 'Create folder'}</button><button type="button" data-picker-action onClick={cancelFolder} disabled={folderBusy}>Cancel</button></div></div> : <button type="button" data-picker-action onClick={beginFolder}>New folder inside {selectedFolder}</button>}
    </div>
    {!supported && <p role="alert">Open an HTTP, HTTPS, or file page before bookmarking it.</p>}
    <button type="submit" disabled={!supported || !title.trim() || busy}>{busy ? 'Saving…' : 'Save bookmark'}</button>
  </form>
}
let BookmarkPicker = () => {
  let { state, run, dismiss } = useUI()
  let { profile, client, tab } = selection(state)
  let bookmarks: Bookmark[] = []
  let activate = async (bookmark: Bookmark, newTab = false, settings?: BookmarkParameters) => {
    if (!bookmark.url || !/^(https?:|file:)/i.test(bookmark.url) || !client?.paneId) return
    let url = parameterizedBookmarkUrl(bookmark.url, settings ?? state.bookmarkParameters?.[profile!.id]?.[bookmark.id])
    let result = newTab
      ? await run('tab.create', { pane: client.paneId, client: client.id, url })
      : tab ? await run('navigate', { tab: tab.id, url }) : undefined
    if (result !== undefined) dismiss()
  }
  let { ref, keys, input, query, change } = usePickerNavigation(row => {
    let bookmark = findBookmark(bookmarks, row.dataset.bookmarkId ?? '')
    if (bookmark) void activate(bookmark, true)
  })
  bookmarks = searchBookmarks(profile?.bookmarks ?? [], query)
  return <div ref={ref} onKeyDown={keys} role="group" aria-label="Choose bookmark"><SearchInput ref={input} aria-label="Search bookmarks" value={query} onChange={change} />{bookmarks.map(bookmark => <BookmarkRow key={`${query}:${bookmark.id}`} bookmark={bookmark} profileId={profile?.id ?? ''} activate={activate} />)}{!bookmarks.length && <p role="status">{query ? 'No matching bookmarks.' : 'No bookmarks in this profile.'}</p>}</div>
}
let findBookmark = (bookmarks: Bookmark[], id: string): Bookmark | undefined => {
  for (let bookmark of bookmarks) {
    if (bookmark.id === id) return bookmark
    if (bookmark.children) {
      let found = findBookmark(bookmark.children, id)
      if (found) return found
    }
  }
}
let BookmarkRow = ({ bookmark, profileId, activate }: { bookmark: Bookmark; profileId: string; activate: (bookmark: Bookmark, newTab?: boolean, settings?: BookmarkParameters) => void }) => {
  let { state, run } = useUI()
  let [expanded, setExpanded] = useState(false)
  let [settings, setSettings] = useState<BookmarkParameters>(() => state.bookmarkParameters?.[profileId]?.[bookmark.id] ?? { values: {}, hidden: [] })
  let supported = !!bookmark.url && /^(https?:|file:)/i.test(bookmark.url)
  let parameters = bookmark.url ? editableBookmarkParameters(bookmark.url, settings) : []
  let visible = parameters.filter(([key]) => !settings.hidden.includes(key))
  let persist = async (next: BookmarkParameters) => run('bookmark.parameters.update', { profile: profileId, bookmark: bookmark.id, ...next })
  let open = async () => { if (parameters.length && await persist(settings) === undefined) return; activate(bookmark, true, settings) }
  let click = () => { void open() }
  let toggle = () => setExpanded(value => !value)
  let update = (key: string, value: string) => setSettings(current => ({ ...current, values: { ...current.values, [key]: value } }))
  let hide = (key: string) => {
    let next = { ...settings, hidden: [...settings.hidden, key] }
    setSettings(next); void persist(next)
  }
  let save = () => { void persist(settings) }
  if (bookmark.children) return <details className={css.folder} open><summary>{bookmark.title || 'Untitled folder'}</summary><div>{bookmark.children.map(child => <BookmarkRow key={child.id} bookmark={child} profileId={profileId} activate={activate} />)}</div></details>
  return <div className={css.bookmarkItem}>
    <div className={css.bookmarkRow}><button className={css.listRow} data-bookmark-id={bookmark.id} disabled={!supported} onClick={click} title={supported ? bookmark.url : 'Unsupported URL type'}>{bookmark.title || bookmark.url}</button>
      {!!visible.length && <button type="button" data-picker-action className={css.bookmarkCustomize} aria-label={`Customize ${bookmark.title || bookmark.url}`} aria-expanded={expanded} onClick={toggle} title="Customize URL parameters"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" /><circle cx="6" cy="4" r="1.5" /><circle cx="10" cy="8" r="1.5" /><circle cx="5" cy="12" r="1.5" /></svg></button>}
    </div>
    {expanded && !!visible.length && <div className={css.bookmarkParameters} aria-label="Bookmark URL parameters">{visible.map(([key, initial]) => {
      let value = settings.values[key] ?? initial
      let label = key === 'x:min_faves' ? 'Min likes' : key === 'x:min_replies' ? 'Min replies' : key === 'x:min_views' ? 'Min views' : key
      let numeric = /^-?\d+(?:\.\d+)?$/.test(initial) && Number.isFinite(Number(initial))
      let number = Number(initial), currentNumber = Number(value) || number
      let minimum = Math.min(0, Math.floor(number * 2), Math.floor(currentNumber * 2)), maximum = Math.max(100, Math.ceil(number * 2), Math.ceil(currentNumber * 2))
      let step = initial.includes('.') ? 10 ** -Math.min(initial.split('.')[1].length, 4) : 1
      let changeValue = (event: ChangeEvent<HTMLInputElement>) => update(key, event.target.value)
      let remove = () => hide(key)
      return <div className={css.bookmarkParameter} key={key}><label><span title={label}>{label}</span><input aria-label={label} type={numeric ? 'number' : 'text'} value={value} step={numeric ? step : undefined} onChange={changeValue} onBlur={save} autoComplete="off" spellCheck={false} /></label>{numeric && <input aria-label={`${label} slider`} type="range" min={minimum} max={maximum} step={step} value={value} onChange={changeValue} onPointerUp={save} onBlur={save} />}<button type="button" data-picker-action className={css.bookmarkRemoveParameter} aria-label={`Remove ${label} parameter`} title={`Remove ${label} from this bookmark URL`} onClick={remove}>×</button></div>
    })}<button type="button" data-picker-action className={css.bookmarkOpenCustomized} onClick={click}>Open</button></div>}
  </div>
}
let HistoryPicker = () => {
  let { state } = useUI()
  let { profile } = selection(state)
  let { ref, keys, input, query, change } = usePickerNavigation()
  let history = searchHistory(profile?.history ?? [], query)
  return <div ref={ref} onKeyDown={keys} role="group" aria-label="Choose history entry"><p>Profile: {profile?.name ?? 'No selected pane'}</p><SearchInput ref={input} aria-label="Search history" value={query} onChange={change} />{history.map(entry => <HistoryRow key={`${entry.url}:${entry.visitedAt}`} entry={entry} />)}{!history.length && <p role="status">{query ? 'No matching history.' : 'No history in this profile.'}</p>}</div>
}
let HistoryRow = ({ entry }: { entry: HistoryEntry }) => {
  let { state, run, dismiss } = useUI()
  let { tab } = selection(state)
  let activate = async () => {
    if (tab && await run('navigate', { tab: tab.id, url: entry.url }) !== undefined) dismiss()
  }
  let visited = new Date(entry.visitedAt)
  return <button className={`${css.listRow} ${css.historyRow}`} onClick={activate} title={entry.url}><span><strong>{entry.title || entry.url}</strong><span>{entry.url}</span></span><time dateTime={visited.toISOString()}>{visited.toLocaleString()}</time></button>
}
let PermissionRow = ({ permission }: { permission: Permission }) => {
  let { run } = useUI()
  let deny = () => { void run('permission.respond', { id: permission.id, allow: false }) }
  let allow = () => { void run('permission.respond', { id: permission.id, allow: true }) }
  return <div className={css.row}>{permission.origin}: {permission.permission}<div><button onClick={deny}>Deny</button><button onClick={allow}>Allow</button></div></div>
}
let downloadSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
let DownloadManager = () => {
  let { state } = useUI()
  let { profile } = selection(state)
  let downloads = state.downloads.filter(download => download.profileId === profile?.id)
  return <section aria-label="Profile downloads"><p>Downloads · {profile?.name}</p>
    {!downloads.length && <p>No downloads in this profile.</p>}
    {downloads.map(download => <DownloadRow key={download.id} download={download} />)}
  </section>
}
let DownloadRow = ({ download }: { download: Download }) => {
  let { run, acknowledgeDownload } = useUI()
  let [busy, setBusy] = useState(false)
  let action = async (event: MouseEvent<HTMLButtonElement>) => {
    let method = event.currentTarget.dataset.method!
    if (method === 'cancel' || method === 'reveal') acknowledgeDownload(download.id)
    setBusy(true)
    try { await run(`download.${method}`, { id: download.id, profile: download.profileId }) }
    finally { setBusy(false) }
  }
  let status = download.paused ? 'Paused' : download.state === 'interrupted' ? download.active ? 'Interrupted' : 'Failed' : download.state === 'progressing' ? 'Downloading' : download.state === 'completed' ? 'Completed' : 'Cancelled'
  let progress = download.total > 0 ? Math.min(100, Math.floor(download.received / download.total * 100)) : undefined
  return <article className={css.download} aria-label={download.name}>
    <strong>{download.name}</strong><span>{status} · {downloadSize(download.received)}{download.total > 0 ? ` / ${downloadSize(download.total)} (${progress}%)` : ' · Size unknown'}</span>
    {download.active && <progress aria-label={`Download progress for ${download.name}`} max={100} value={progress} />}
    <div>
      {download.active && download.state === 'progressing' && !download.paused && <button disabled={busy} data-method="pause" onClick={action}>Pause</button>}
      {download.active && (download.paused || download.state === 'interrupted') && <button disabled={busy || !download.canResume} data-method="resume" onClick={action}>Resume</button>}
      {download.active && <button disabled={busy} data-method="cancel" onClick={action}>Cancel</button>}
      {download.state === 'completed' && <button disabled={busy} data-method="reveal" onClick={action}>Show in Finder</button>}
    </div>
  </article>
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
  let bindings = [...Object.entries(keyboard.shortcuts).map(([key, binding]) => [shortcutLabel(key, binding), shortcutAction(binding)]), ...Object.entries(keyboard.sequences).map(([key, binding]) => [shortcutLabel(key.split('').join(' '), binding), shortcutAction(binding)]), ...Object.entries(keyboard.prefixBindings).map(([key, action]) => [`${keyboard.prefix} then ${key}`, action])].map(([key, action]) => ({ key, action, description: entries.find(entry => entry.action === action)?.description ?? '' })).filter(binding => fuzzyMatch(query, `${binding.key} ${binding.action} ${binding.description}`))
  let commands = searchCommands(entries, query), notes = HELP_NOTES.filter(note => fuzzyMatch(query, note))
  let change = (event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value); setSearching(true) }
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
    <div className={css.helpSearch}><SearchInput ref={input} aria-label="Search help" value={query} onChange={change} /><span role="status">{query ? `${bindings.length + commands.length + notes.length} matches · Esc clears search` : 'Esc closes help'}</span></div>
    {!!bindings.length && <><h2>Shortcuts</h2><dl>{bindings.map(binding => <HelpRow key={binding.key} label={binding.key} description={binding.action} query={query} />)}</dl></>}
    {!!commands.length && <><h2>Commands</h2><dl className={css.helpCommands}>{commands.map(entry => <HelpRow key={entry.command} label={entry.usage ?? entry.command} description={entry.description} query={query} />)}</dl></>}
    {notes.map(note => <p key={note}>{note}</p>)}
    {!bindings.length && !commands.length && !notes.length && <p>No matching help entries.</p>}
  </div>
}

let ToolStatus = () => {
  let { state, show, run, control } = useUI()
  let { tab, profile } = selection(state)
  let tools = state.browserTools, current = tab && tools?.tabs[tab.id]
  let configure = () => show('browser-tools')
  let plugins = () => show('plugins')
  let edit = () => { void run('settings.open') }
  let blocking = !current?.origin ? 'No website selected' : current.adblock ? 'On' : 'Off'
  let filters = tools?.filters
  return <section className={css.toolStatus} aria-label="Tools status">
    <h2>Tools status</h2>
    <p>{profile?.name ?? 'No profile'} · {current?.origin || 'No website selected'}</p>
    <dl>
      <div><dt>Ad blocking</dt><dd>{blocking}{current?.origin && ` · ${current.blocked} requests blocked since navigation`}</dd></div>
      <div><dt>Filter lists</dt><dd>{!filters ? 'Loading' : filters.error ? 'Needs attention' : filters.updating ? 'Updating' : filters.network ? 'Ready' : 'Unavailable'}</dd></div>
      <div><dt>Website dark mode</dt><dd>{current?.origin ? current.darkMode === 'dark' ? 'On' : current.darkMode === 'system' ? 'Follow system' : 'Off' : 'No website selected'}</dd></div>
      <div><dt>Userscripts</dt><dd>{tools ? `${tools.scripts.filter(script => script.enabled).length} enabled · ${tools.scripts.filter(script => script.error).length} errors` : 'Loading'}</dd></div>
      <div><dt>Plugins</dt><dd>{state.plugins?.filter(plugin => plugin.enabled).length ?? 0} enabled · {state.plugins?.filter(plugin => plugin.error).length ?? 0} errors</dd></div>
    </dl>
    {current?.error && <p className={css.error}>{current.error}</p>}
    {filters?.error && <p className={css.error}>{filters.error}</p>}
    <div className={css.toolActions}>{control !== 'browser-tools' && <button onClick={configure}>Configure browser tools</button>}{control !== 'plugins' && <button onClick={plugins}>Manage plugins</button>}{control === 'plugins' && <button onClick={edit}>Edit config</button>}</div>
  </section>
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
  return <><ToolStatus /><h2>Browser tool settings</h2><p>{profile?.name} · {current?.origin || 'Open a website to change its settings'}</p>
    <div className={css.toolOptions}><label>Apply changes to<select value={scope} onChange={changeScope}><option value="site">This site in this profile</option><option value="profile">This profile</option><option value="global">All profiles</option></select></label>
      <button onClick={adblock} disabled={!tab || (scope === 'site' && !current?.origin)} aria-pressed={settings?.adblock}>Ad and tracker blocking: {settings?.adblock ? 'on' : 'off'}</button>
      <label>Website dark mode<select value={settings?.darkMode ?? 'off'} onChange={dark} disabled={!tab || (scope === 'site' && !current?.origin)}><option value="off">Off</option><option value="dark">Dark Reader</option><option value="system">Follow system</option></select></label>
      <button onClick={inherit} disabled={!tab || (scope === 'site' && !current?.origin)}>Reset to inherited settings</button>
    </div>
    {scope !== 'site' && <p>Existing site overrides still apply. This page: blocking {current?.adblock ? 'on' : 'off'}, dark mode {current?.darkMode ?? 'off'}.</p>}
    {current?.error && <p className={css.error}>{current.error}</p>}
    <p>{current?.blocked ?? 0} requests blocked since navigation. Turning blocking off allows new requests; reload to retry resources already blocked.</p>
    {!!current?.recent.length && <details><summary>Blocked requests</summary>{current.recent.map((request, index) => <div className={css.row} key={`${request.time}:${index}`}>{request.host} · {request.type} · {new Date(request.time).toLocaleTimeString()}</div>)}</details>}
    <p>{tools?.filters.network ?? 0} network rules · {tools?.filters.cosmetic ?? 0} cosmetic rules. Filters updated {tools?.filters.updatedAt ? new Date(tools.filters.updatedAt).toLocaleDateString() : 'never'}.</p>
    {tools?.filters.error && <p className={css.error}>{tools.filters.error}</p>}
    <button onClick={update} disabled={tools?.filters.updating}>{tools?.filters.updating ? 'Updating filters…' : 'Update filters'}</button>
    <p>Userscripts and styles</p>
    {tools?.scripts.length ? tools.scripts.map(script => <label className={css.row} key={script.id}><input type="checkbox" data-id={script.id} checked={script.enabled} onChange={toggleScript} />{script.name}{script.error && <span className={css.error}>{script.error}</span>}</label>) : <p>Add local .js or .css files under browser.userscripts in the config. JavaScript changes apply on the next navigation.</p>}
    <button onClick={reload}>Reload scripts</button><button onClick={edit}>Edit config</button>
    <p>Use <code>save-fill</code> to save a form, <code>fill</code> to restore it.</p><button onClick={plugins}>Form fills and plugins</button>
  </>
}

let KeyboardSettings = () => {
  let { state, run, show, onMessage } = useUI()
  let makeDefault = async () => { if (await run('settings.default-browser')) onMessage('Default browser requested. Confirm any macOS prompt; you can also choose bmux in System Settings > Desktop & Dock.') }
  let tools = () => show('browser-tools')
  let keyboard = state.keyboard ?? DEFAULT_KEYBOARD
  let edit = () => { void run('settings.open') }
  let reload = () => { void run('settings.reload') }
  return <><ToolStatus /><button onClick={makeDefault}>Make bmux the default browser</button><button onClick={tools}>Browser tools</button><p>{state.configPath}</p><p>Changes reload automatically. Set a binding to null to disable it. Invalid edits keep the last working configuration. Use an action and <code>when: pane-not-editing</code> to limit a shortcut to page content outside text fields.</p>{state.configError && <p className={css.error}>{state.configError}</p>}<p>Status bar: {state.statusBar ?? 'top'}. Set <code>statusBar: top</code> or <code>statusBar: bottom</code>.</p><p>Tab close buttons: {state.showTabCloseButtons ? 'enabled' : 'hidden'}. Set <code>showTabCloseButtons: true</code> to show them.</p><p>Accessibility: {state.accessibility ? 'enabled' : 'automatic'}. Set <code>accessibility: true</code> in the config to expose page controls to oVim and other accessibility tools.</p><p>Prefix: {keyboard.prefix}</p><pre>{'statusBar: top\nshowTabCloseButtons: false\nkeyboard:\n  prefix: Ctrl+B\n  shortcuts:\n    Cmd+R: reload\n    Cmd+,: settings\n  prefixBindings:\n    ":": command'}</pre><button onClick={edit}>Edit config</button><button onClick={reload}>Reload config</button></>
}
