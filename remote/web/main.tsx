import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, PointerEvent, WheelEvent, ChangeEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { api, createViewer } from './client'
import type { Host, State } from './client'
import styles from './style.module.css'
import { RemoteAccount } from '../../src/renderer/RemoteAccount'
import { RemoteMachineDetails, useRemoteMachineColors } from '../../src/renderer/RemoteMachine'
import { remoteMachineName } from '../../src/shared/remote-tree'
import type { RemoteSession } from '../../src/shared/remote-sessions'
import { SessionTree } from './SessionTree'
import type { RemoteResumeAcknowledgement } from '../../src/shared/remote-attention'
let visitBilling = (url: string) => { let target = new URL(url); if (target.protocol !== 'https:' || !['checkout.stripe.com','billing.stripe.com'].includes(target.hostname)) throw new Error('Invalid checkout URL'); location.assign(target.href) }

type Viewer = Awaited<ReturnType<typeof createViewer>>
let sessionFromUrl = () => {
  let params = new URLSearchParams(location.search), host = params.get('host'), session = params.get('session')
  return host && session ? `${host}:${session}` : ''
}
let setSessionUrl = (host?: string, session?: string) => {
  let url = new URL(location.href)
  if (host && session) { url.searchParams.set('host', host); url.searchParams.set('session', session) }
  else { url.searchParams.delete('host'); url.searchParams.delete('session') }
  if (url.href !== location.href) history.pushState(null, '', url)
}
type IconName = 'back' | 'forward' | 'reload' | 'link' | 'type' | 'close' | 'sessions' | 'fit' | 'enter' | 'user'
let Icon = ({ name }: { name: IconName }) => {
  let paths: Record<IconName, ReactNode> = {
    back: <path d="m14.5 5-7 7 7 7M8 12h12" />,
    forward: <path d="m9.5 5 7 7-7 7m6.5-7H4" />,
    reload: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9A7 7 0 0 1 18 6l2 1M4 17l2 1a7 7 0 0 0 12.5-3" /></>,
    link: <><path d="M10 7H5v12h12v-5M13 5h6v6M19 5l-9 9" /></>,
    type: <><path d="M4 7h16M12 7v12M8 19h8" /></>,
    close: <path d="M5 5l14 14M19 5 5 19" />,
    sessions: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></>,
    fit: <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" />,
    enter: <path d="M20 6v6a4 4 0 0 1-4 4H5m5-5-5 5 5 5" />,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
  }
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
let GoogleIcon = () => <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.25 5.48-4.75 7.18l7.73 6C44.43 38.03 46.98 31.87 46.98 24.55z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.2A23.9 23.9 0 0 0 0 24c0 3.86.92 7.5 2.53 10.79l8-6.2z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.92-5.8l-7.73-6c-2.14 1.44-4.88 2.3-8.19 2.3-6.26 0-11.57-4.22-13.47-9.91l-8 6.2C6.51 42.62 14.62 48 24 48z"/></svg>
let App = () => {
  let [viewer, setViewer] = useState<Viewer>(), [hosts, setHosts] = useState<Host[]>([]), [state, setState] = useState<State>()
  let [error, setError] = useState(''), [address, setAddress] = useState(''), [text, setText] = useState(''), [watching, setWatching] = useState(false)
  let [selectedId, setSelectedId] = useState(''), [usage, setUsage] = useState<{ service: string; started: number; succeeded: number; failed: number; browser_ms: number }[]>([])
  let [target, setTarget] = useState(sessionFromUrl)
  let [owner, setOwner] = useState(''), [services, setServices] = useState<{ id: string; revoked: boolean }[]>([])
  let [providers, setProviders] = useState<{ appleEnabled: boolean; appleLinked: boolean }>()
  let [serviceName, setServiceName] = useState(''), [createdKey, setCreatedKey] = useState(''), [keyService, setKeyService] = useState('')
  let [grantService, setGrantService] = useState(''), [grantUser, setGrantUser] = useState(''), [grantPermission, setGrantPermission] = useState<'watch' | 'control'>('watch')
  let [grants, setGrants] = useState<{ service: string; user_id: string; permission: string }[]>([])
  let [view, setView] = useState<'sessions' | 'service'>(() => ['account','boxes'].includes(new URLSearchParams(location.search).get('view') || '') ? 'service' : 'sessions')
  let [rent, setRent] = useState(new URLSearchParams(location.search).get('view') === 'boxes')
  let [auth, setAuth] = useState<'checking' | 'signed-out' | 'connecting' | 'ready'>('checking')
  let [knownAccount, setKnownAccount] = useState(() => localStorage.getItem('bmux-known-account') === '1')
  let [googleReady, setGoogleReady] = useState(false)
  let [hostsLoaded, setHostsLoaded] = useState(false)
  let [machineId, setMachineId] = useState<string>()
  let machine = hosts.find(host => host.id === machineId), machineColors = useRemoteMachineColors(hosts)
  let [resuming,setResuming]=useState(false)
  let listed = hosts.flatMap(host => host.sessions.flatMap(session => session.panes.length ? [{ host, session, pane: session.panes[0] }] : []))
  let selected = listed.find(item => `${item.host.id}:${item.session.id}` === selectedId)
  let video = useRef<HTMLVideoElement>(null), googleClient = useRef<{ requestAccessToken: () => void } | undefined>(undefined), inputDialog = useRef<HTMLDialogElement>(null), inputField = useRef<HTMLInputElement>(null), active = useRef<Viewer | undefined>(undefined), reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), watchRequest = useRef(0)
  let [inputMode, setInputMode] = useState<'address' | 'text'>('text')
  let viewport = state && state.viewports[state.pane]
  let session = state?.sessions.find(session => session.windows.some(window => window.panes.some(pane => pane.id === state.pane)))
  let lease = session && state?.controls[session.id], controlling = !!viewer && !!lease && lease.owner === viewer.id
  let report = (error: unknown) => setError(error instanceof Error ? error.message : 'Operation failed')
  let signOut = async () => {
    try { await api('/api/logout', {}) }
    catch (error) { if (!(error instanceof Error) || error.message !== 'Sign in to continue') throw error }
    localStorage.removeItem('bmux-known-account')
    location.replace('/')
  }
  let connect = async () => {
    clearTimeout(reconnectTimer.current)
    setAuth('connecting'); setHostsLoaded(false)
    active.current?.close(); active.current = undefined; setViewer(undefined); setHosts([]); setState(undefined); setSelectedId(''); setError('')
    if (video.current) video.current.srcObject = null
    let next = await createViewer({ hosts: nextHosts => { setHosts(nextHosts); setHostsLoaded(true) }, stream: stream => { if (video.current) { video.current.srcObject = stream; void video.current.play().catch(() => undefined) } }, state: setState, error: setError, disconnected: () => { if (video.current) video.current.srcObject = null; setState(undefined); setSelectedId(''); setHosts([]); setHostsLoaded(false); setViewer(undefined); setAuth('connecting'); setError('Connection lost. Trying again.'); reconnectTimer.current = setTimeout(() => { void connect().catch(report) }, 2000) } })
    active.current = next; setViewer(next); setAuth('ready')
    let [account, listed, access, counts] = await Promise.all([api('/api/me'), api('/api/services'), api('/api/grants'), api('/api/usage')])
    setOwner(account.owner); setServices(listed); setGrants(access); setUsage(counts)
    setProviders(await api('/api/auth/providers'))
  }
  useEffect(() => {
    let cancelled = false
    void api('/api/me').then(() => { if (!cancelled) { localStorage.setItem('bmux-known-account', '1'); setKnownAccount(true); void connect().catch(report) } }).catch(error => {
      if (cancelled) return
      if (error instanceof Error && error.message === 'Sign in to continue') { localStorage.removeItem('bmux-known-account'); setKnownAccount(false); setAuth('signed-out') }
      else report(error)
    })
    let script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true
    script.nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? ''
    script.onload = () => {
      void api('/api/config').then(config => {
        if (cancelled) return
        let google = (window as any).google
        googleClient.current = google.accounts.oauth2.initTokenClient({ client_id: config.googleClientId, scope: 'openid email', callback: (response: { access_token?: string; error?: string }) => {
          if (!response.access_token) { if (response.error) report(new Error('Google sign-in failed')); return }
          setAuth('connecting')
          void api('/api/login', { accessToken: response.access_token }).then(() => { localStorage.setItem('bmux-known-account', '1'); setKnownAccount(true); return connect() }).catch(error => { setAuth('signed-out'); report(error) })
        } })
        setGoogleReady(true)
      }).catch(report)
    }
    document.head.append(script)
    return () => { cancelled = true; clearTimeout(reconnectTimer.current); active.current?.close(); script.remove() }
  }, [])
  useEffect(() => {
    if (!viewer || !controlling || !session || !lease) return
    let timer = setInterval(() => viewer.send({ type: 'renew', session: session.id, generation: lease.generation }), 10000)
    return () => clearInterval(timer)
  }, [viewer, controlling, session?.id, lease?.generation])
  useEffect(() => {
    if (!viewer) return
    let timer = setInterval(() => { void api('/api/usage').then(setUsage).catch(() => undefined) }, 15000)
    return () => clearInterval(timer)
  }, [viewer])
  let watch = (host: Host, session: Host['sessions'][number], updateUrl = true, preferredPane?: string) => {
    let pane = preferredPane ?? (selectedId === `${host.id}:${session.id}` && state ? state.pane : session.panes[0]?.id)
    if (!viewer || !pane) return
    setMachineId(undefined)
    if (selectedId === `${host.id}:${session.id}` && state) { if (pane !== state.pane) viewer.send({ type: 'switch', pane }); return }
    let request = ++watchRequest.current
    if (updateUrl) { setSessionUrl(host.id, session.id); setTarget(`${host.id}:${session.id}`) }
    setSelectedId(`${host.id}:${session.id}`); setWatching(true); setState(undefined); setError('')
    if (video.current) video.current.srcObject = null
    void viewer.watch(host, session.id, pane).catch(error => { if (request === watchRequest.current) report(error) }).finally(() => { if (request === watchRequest.current) setWatching(false) })
  }
  let leave = (updateUrl = true) => { ++watchRequest.current; viewer?.stop(); if (updateUrl) { setSessionUrl(); setTarget('') } setSelectedId(''); setWatching(false); setState(undefined); setError(''); if (video.current) video.current.srcObject = null }
  useEffect(() => {
    if (!viewer || !hostsLoaded || !target || selectedId === target) return
    let match = listed.find(item => `${item.host.id}:${item.session.id}` === target)
    if (match) watch(match.host, match.session, false)
  }, [viewer, hosts, hostsLoaded, target, selectedId])
  useEffect(() => {
    let restore = () => { leave(false); setTarget(sessionFromUrl()); setView('sessions') }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [viewer])
  let createService = (event: FormEvent) => { event.preventDefault(); void api('/api/services', { service: serviceName.trim() }).then(async (result) => { setCreatedKey(result.key); setKeyService(result.service); setServiceName(''); setServices(await api('/api/services')); setError('') }).catch(report) }
  let rotateService = (service: string) => { void api('/api/services/rotate', { service }).then(result => { setCreatedKey(result.key); setKeyService(result.service); setError('') }).catch(report) }
  let revokeService = (service: string) => { if (!window.confirm(`Revoke ${service} and disconnect its hosts?`)) return; void api('/api/services/revoke', { service }).then(async () => { setServices(await api('/api/services')); setError('') }).catch(report) }
  let saveGrant = (event: FormEvent) => { event.preventDefault(); void api('/api/grants', { service: grantService, user: grantUser.trim(), permission: grantPermission }).then(async () => { setGrants(await api('/api/grants')); setGrantUser(''); setError('') }).catch(report) }
  let removeGrant = (service: string, user: string) => { void api('/api/grants', { service, user, permission: null }).then(async () => setGrants(await api('/api/grants'))).catch(report) }
  let resize = () => { if (controlling && video.current) viewer?.send({ type: 'resize', generation: lease?.generation, width: Math.max(320, Math.min(1920, Math.round(video.current.clientWidth))), height: Math.max(200, Math.min(1080, Math.round(video.current.clientHeight))) }) }
  let acquire = () => { if (session) viewer?.send({ type: 'acquire', session: session.id, takeover: !!lease }) }
  let release = () => { if (session) viewer?.send({ type: 'release', session: session.id }) }
  let help = state?.attention?.find(item => item.pane === state.pane)
  let resume = () => {
    if (!controlling || !help || !viewer || !session || resuming || help.status==='verifying') return
    setResuming(true)
    void viewer.request<RemoteResumeAcknowledgement>({type:'resume',generation:lease?.generation,episode:help.episode,...(help.revision ? {revision:help.revision} : {})}).then(result=>{
      if(result.resumed!==true)throw new Error('Resume was not acknowledged')
      viewer.send({type:'release',session:session.id})
    }).catch(report).finally(()=>setResuming(false))
  }
  let command = (method: string, args: Record<string, unknown> = {}) => { if (controlling && state) viewer?.send({ type: 'command', generation: lease?.generation, command: { method, args: { tab: state.pane, ...args } } }) }
  let navigate = (event: FormEvent) => { event.preventDefault(); if (address.trim()) command('navigate', { url: address.trim() }); inputDialog.current?.close() }
  let back = () => command('back'), forward = () => command('forward'), reload = () => command('reload')
  let choosePane = (event: ChangeEvent<HTMLSelectElement>) => viewer?.send({ type: 'switch', pane: event.target.value })
  let pointer = (event: PointerEvent<HTMLVideoElement> | WheelEvent<HTMLVideoElement>, type: string) => {
    if (!controlling || !video.current) return
    event.preventDefault()
    let target = video.current, rect = target.getBoundingClientRect(), scale = Math.min(rect.width / target.videoWidth, rect.height / target.videoHeight)
    let x = Math.round((event.clientX - rect.left - (rect.width - target.videoWidth * scale) / 2) / scale), y = Math.round((event.clientY - rect.top - (rect.height - target.videoHeight * scale) / 2) / scale)
    if (x < 0 || y < 0 || x > target.videoWidth || y > target.videoHeight || !viewport) return
    x = Math.round(x * viewport.width / target.videoWidth); y = Math.round(y * viewport.height / target.videoHeight)
    viewer?.send({ type: 'input', generation: lease?.generation, viewportGeneration: viewport?.generation, event: { type, x, y, button: event.button === 2 ? 'right' : 'left', clickCount: 1, ...(type === 'mouseWheel' ? { deltaX: (event as WheelEvent).deltaX, deltaY: (event as WheelEvent).deltaY } : {}) } })
  }
  let down = (event: PointerEvent<HTMLVideoElement>) => { event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); pointer(event, 'mouseDown') }
  let up = (event: PointerEvent<HTMLVideoElement>) => pointer(event, 'mouseUp')
  let move = (event: PointerEvent<HTMLVideoElement>) => pointer(event, 'mouseMove')
  let scroll = (event: WheelEvent<HTMLVideoElement>) => pointer(event, 'mouseWheel')
  let keyboard = (event: KeyboardEvent<HTMLVideoElement>) => {
    if (!controlling || event.nativeEvent.isComposing) return
    event.preventDefault()
    let keyCode = ({ ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' } as Record<string, string>)[event.key] ?? event.key
    let modifiers = [event.shiftKey && 'shift', event.ctrlKey && 'control', event.altKey && 'alt', event.metaKey && 'meta'].filter(Boolean)
    viewer?.send({ type: 'input', generation: lease?.generation, viewportGeneration: viewport?.generation, event: { type: event.type === 'keyup' ? 'keyUp' : event.key.length === 1 && !event.ctrlKey && !event.metaKey ? 'char' : 'keyDown', keyCode, modifiers } })
  }
  let changeAddress = (event: ChangeEvent<HTMLInputElement>) => setAddress(event.target.value)
  let changeText = (event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)
  let enter = () => command('key', { key: 'Enter' })
  let sendText = (event: FormEvent) => { event.preventDefault(); if (controlling && text) { viewer?.send({ type: 'text', generation: lease?.generation, text }); setText('') } inputDialog.current?.close() }
  let openInput = (mode: 'address' | 'text') => { setInputMode(mode); inputDialog.current?.showModal(); inputField.current?.focus() }
  let showSessions = () => { inputDialog.current?.close(); leave(); setMachineId(undefined); setView('sessions') }
  let selectTree = (host: Host, session: RemoteSession, pane?: string) => watch(host, session, true, pane)
  let closeMachine = () => { setMachineId(undefined); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-machine-details="${CSS.escape(machineId ?? '')}"]`)?.focus({ preventScroll: true })) }
  let connectRelay = () => { leave(); setRent(false); setView('service') }
  let addBox = () => { leave(); setRent(true); setView('service') }
  let signIn = () => googleClient.current?.requestAccessToken()
  return <main className={styles.main}>
    <header className={styles.header}><button className={styles.brand} onClick={showSessions} aria-label="BMUX home"><img src="https://cdn.digthree.tonis.dev/bmux/website-ca1a3c8712d7/icon-512.png" alt="" width="28" height="28" />bmux</button><span className={styles.headerLabel}>Remote</span>{(viewer || knownAccount) && <button className={styles.avatar} onClick={() => { if (!viewer) return; if (selected) leave(); setRent(false); setView(view === 'service' && !rent ? 'sessions' : 'service') }} aria-label="Account" title="Account" disabled={!viewer} aria-busy={auth !== 'ready'}><Icon name="user" />{auth !== 'ready' && <span className={styles.avatarSpinner} />}</button>}</header>
    {error && <p role="status" className={styles.error}>{error}</p>}
    {!viewer && <section className={styles.signIn}>{auth === 'signed-out' ? <><p>Sign in to see your sessions.</p><button className={styles.googleButton} onClick={() => googleClient.current?.requestAccessToken()} disabled={!googleReady}><GoogleIcon />Sign in with Google</button></> : <p role="status" className={styles.loadingMessage}><span className={styles.spinner} />{auth === 'connecting' ? 'Connecting to your sessions…' : 'Checking your session…'}</p>}</section>}
    {view === 'sessions' && viewer && <div className={`${styles.workspace} ${selected || machine ? styles.workspaceActive : ''}`}><aside className={styles.library} aria-label="Sessions"><div className={styles.sectionHeading}><h1>Sessions</h1><span>{hostsLoaded ? listed.length : '…'}</span></div><div className={styles.libraryActions}><button onClick={connectRelay}>Relay</button><button onClick={addBox}>Add box</button></div>{hostsLoaded && listed.length === 0 && <p>No sessions available</p>}
      <div className={styles.sessions}><SessionTree hosts={hosts} selected={selectedId} pane={state?.pane} select={selectTree} details={host => setMachineId(host.id)} color={machineColors.color} /></div>
    </aside>
    {machine && <section className={styles.machineDetails} aria-label="Remote machine details"><RemoteMachineDetails host={machine} name={remoteMachineName(machine, hosts)} color={machineColors.color(machine.id)} changeColor={color => machineColors.save(machine.id, color)} back={{ label: 'Back to preview', run: closeMachine }} /></section>}
    {selected ? <section className={styles.viewer} aria-label="Session viewer" hidden={!!machine}>
      <div className={styles.viewerToolbar}><button className={`${styles.iconButton} ${styles.mobileBack}`} onClick={showSessions} aria-label="Sessions" title="Sessions"><Icon name="back" /></button>
        {state && <select className={styles.paneSelect} aria-label="Pane" value={state.pane} onChange={choosePane}>{state.sessions.flatMap(session => session.windows.flatMap(window => window.panes.map(pane => <option key={pane.id} value={pane.id}>{session.name} · {pane.title || pane.url || 'Blank page'}</option>)))}</select>}
        <span className={styles.status}>{watching ? 'Connecting' : controlling ? 'Controlling' : 'Watching'}</span>
        {selected.host.permission === 'control' && state && (controlling ? <button className={styles.controlButton} onClick={release}>Release control</button> : <button className={styles.controlButton} onClick={acquire}>{lease ? 'Take over' : 'Take control'}</button>)}
      </div>
      {help && <div className={styles.attention}><span>{help.status==='verifying' ? 'Verifying' : help.reason === 'help' ? 'Agent needs your help. Resolve the issue, then resume.' : 'Automation paused for verification. Resolve the issue, then resume.'}</span>{controlling && help.status!=='verifying' && <button onClick={resume} disabled={resuming}>Resume automation</button>}</div>}
      <video ref={video} className={styles.video} muted autoPlay playsInline tabIndex={0} data-viewport-width={viewport?.width} data-viewport-height={viewport?.height} onPointerDown={down} onPointerUp={up} onPointerMove={move} onWheel={scroll} onKeyDown={keyboard} onKeyUp={keyboard} aria-label="Remote browser" />
      {controlling && <div className={styles.controls}><div className={styles.controlGroup}><button className={styles.iconButton} onClick={back} aria-label="Back" title="Back"><Icon name="back" /></button><button className={styles.iconButton} onClick={forward} aria-label="Forward" title="Forward"><Icon name="forward" /></button><button className={styles.iconButton} onClick={reload} aria-label="Reload" title="Reload"><Icon name="reload" /></button></div><div className={styles.controlGroup}><button className={styles.iconButton} onClick={() => openInput('address')} aria-label="Open address" title="Open address"><Icon name="link" /></button><button className={styles.iconButton} onClick={() => openInput('text')} aria-label="Type into page" title="Type into page"><Icon name="type" /></button><button className={styles.iconButton} onClick={enter} aria-label="Enter" title="Enter"><Icon name="enter" /></button><button className={styles.iconButton} onClick={resize} aria-label="Fit viewport" title="Fit viewport"><Icon name="fit" /></button></div></div>}
    </section> : !machine && <section className={styles.emptyViewer} aria-label="Session preview"><p>Select a session.</p></section>}</div>}
    <dialog ref={inputDialog} className={styles.dialog} aria-label={inputMode === 'address' ? 'Open address' : 'Type into page'}><form onSubmit={inputMode === 'address' ? navigate : sendText}><div className={styles.dialogHeading}><strong>{inputMode === 'address' ? 'Open address' : 'Type into page'}</strong><button type="button" className={styles.iconButton} onClick={() => inputDialog.current?.close()} aria-label="Close"><Icon name="close" /></button></div><input ref={inputField} aria-label={inputMode === 'address' ? 'Address' : 'Text'} type={inputMode === 'address' ? 'url' : 'text'} value={inputMode === 'address' ? address : text} onChange={inputMode === 'address' ? changeAddress : changeText} placeholder={inputMode === 'address' ? 'https://example.com' : 'Enter text'} required /><button className={styles.primaryButton}>{inputMode === 'address' ? 'Go' : 'Type'}</button></form></dialog>
    {view === 'service' && viewer && <section className={styles.serviceView}><div className={styles.sectionHeading}><button onClick={showSessions}><Icon name="back" />Sessions</button></div><h2>{rent ? 'Add box' : 'Account'}</h2><RemoteAccount api={api} visit={visitBilling} signIn={signIn} signOut={signOut} rent={rent} view={rent ? 'boxes' : 'account'} />{!rent && <><p>Account ID: <code>{owner}</code></p>{providers?.appleEnabled && <p>{providers.appleLinked ? 'Apple linked' : <a href="/api/auth/providers/apple/link">Link Apple</a>}</p>}<details><summary>Services and access</summary>
      <form className={styles.row} onSubmit={createService}><input aria-label="New service name" placeholder="Service name" value={serviceName} onChange={event => setServiceName(event.target.value)} required /><button>Create API key</button></form>
      {createdKey && <p>Save the key for {keyService} now. It is shown once: <code>{createdKey}</code><button onClick={() => setCreatedKey('')}>Dismiss</button></p>}
      {services.filter(service => !service.revoked).map(service => <p key={service.id}>{service.id} <button onClick={() => rotateService(service.id)}>Rotate key</button> <button onClick={() => revokeService(service.id)}>Revoke</button></p>)}
      {services.filter(service => !service.revoked).length > 0 && <form className={styles.row} onSubmit={saveGrant}>
        <select aria-label="Grant service" value={grantService} onChange={event => setGrantService(event.target.value)} required><option value="">Service</option>{services.filter(service => !service.revoked).map(service => <option key={service.id}>{service.id}</option>)}</select>
        <input aria-label="User account ID" placeholder="User account ID" value={grantUser} onChange={event => setGrantUser(event.target.value)} required />
        <select aria-label="Permission" value={grantPermission} onChange={event => setGrantPermission(event.target.value as 'watch' | 'control')}><option value="watch">Watch</option><option value="control">Control</option></select><button>Grant</button>
      </form>}
      {grants.map(grant => <p key={`${grant.service}:${grant.user_id}`}>{grant.service} · <code>{grant.user_id}</code> · {grant.permission} <button onClick={() => removeGrant(grant.service, grant.user_id)}>Remove</button></p>)}
    </details>
    <div className={styles.usage}><h3>Usage <span>LAST 30 DAYS</span></h3>{usage.length ? <div className={styles.tableScroll}><table><thead><tr><th>Service</th><th>Started</th><th>Succeeded</th><th>Failed</th><th>Active minutes</th></tr></thead><tbody>{usage.map(item => <tr key={item.service}><td>{item.service}</td><td>{item.started}</td><td>{item.succeeded}</td><td>{item.failed}</td><td>{Math.round(item.browser_ms / 60000)}</td></tr>)}</tbody></table></div> : <p>No usage in the last 30 days.</p>}</div></>}</section>}
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
