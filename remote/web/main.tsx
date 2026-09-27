import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, PointerEvent, WheelEvent, ChangeEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { api, createViewer } from './client'
import type { Host, State } from './client'
import styles from './style.module.css'

type Viewer = Awaited<ReturnType<typeof createViewer>>
type IconName = 'back' | 'forward' | 'reload' | 'link' | 'type' | 'close' | 'sessions' | 'fit' | 'enter'
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
  }
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
let App = () => {
  let [viewer, setViewer] = useState<Viewer>(), [hosts, setHosts] = useState<Host[]>([]), [state, setState] = useState<State>()
  let [error, setError] = useState(''), [address, setAddress] = useState(''), [text, setText] = useState(''), [watching, setWatching] = useState(false)
  let [selectedId, setSelectedId] = useState(''), [usage, setUsage] = useState<{ service: string; started: number; succeeded: number; failed: number; browser_ms: number }[]>([])
  let [owner, setOwner] = useState(''), [services, setServices] = useState<{ id: string; revoked: boolean }[]>([])
  let [serviceName, setServiceName] = useState(''), [createdKey, setCreatedKey] = useState(''), [keyService, setKeyService] = useState('')
  let [grantService, setGrantService] = useState(''), [grantUser, setGrantUser] = useState(''), [grantPermission, setGrantPermission] = useState<'watch' | 'control'>('watch')
  let [grants, setGrants] = useState<{ service: string; user_id: string; permission: string }[]>([])
  let [view, setView] = useState<'sessions' | 'service'>('sessions')
  let listed = hosts.flatMap(host => host.sessions.flatMap(session => session.panes.length ? [{ host, session, pane: session.panes[0] }] : []))
  let selected = listed.find(item => `${item.host.id}:${item.session.id}` === selectedId)
  let video = useRef<HTMLVideoElement>(null), loginButton = useRef<HTMLDivElement>(null), inputDialog = useRef<HTMLDialogElement>(null), inputField = useRef<HTMLInputElement>(null), active = useRef<Viewer | undefined>(undefined), reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), watchRequest = useRef(0)
  let [inputMode, setInputMode] = useState<'address' | 'text'>('text')
  let viewport = state && state.viewports[state.pane]
  let session = state?.sessions.find(session => session.windows.some(window => window.panes.some(pane => pane.id === state.pane)))
  let lease = session && state?.controls[session.id], controlling = !!viewer && !!lease && lease.owner === viewer.id
  let report = (error: unknown) => setError(error instanceof Error ? error.message : 'Operation failed')
  let connect = async () => {
    clearTimeout(reconnectTimer.current)
    active.current?.close(); active.current = undefined; setViewer(undefined); setHosts([]); setState(undefined); setSelectedId(''); setError('')
    if (video.current) video.current.srcObject = null
    let next = await createViewer({ hosts: setHosts, stream: stream => { if (video.current) { video.current.srcObject = stream; void video.current.play().catch(() => undefined) } }, state: setState, error: setError, disconnected: () => { if (video.current) video.current.srcObject = null; setState(undefined); setSelectedId(''); setHosts([]); setViewer(undefined); setError('Connection lost. Trying again.'); reconnectTimer.current = setTimeout(() => { void connect().catch(report) }, 2000) } })
    active.current = next; setViewer(next)
    let [account, listed, access, counts] = await Promise.all([api('/api/me'), api('/api/services'), api('/api/grants'), api('/api/usage')])
    setOwner(account.owner); setServices(listed); setGrants(access); setUsage(counts)
  }
  useEffect(() => {
    let cancelled = false
    void api('/api/me').then(() => { if (!cancelled) void connect().catch(report) }).catch(() => undefined)
    let script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true
    script.nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? ''
    script.onload = () => {
      void api('/api/config').then(config => {
        if (cancelled) return
        let google = (window as any).google
        google.accounts.id.initialize({ client_id: config.googleClientId, callback: (response: { credential: string }) => { void api('/api/login', response).then(connect).catch(report) } })
        google.accounts.id.renderButton(loginButton.current, { theme: 'outline', size: 'large' })
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
  let watch = (host: Host, session: Host['sessions'][number]) => {
    if (!viewer || !session.panes[0]) return
    let request = ++watchRequest.current
    setSelectedId(`${host.id}:${session.id}`); setWatching(true); setState(undefined); setError('')
    if (video.current) video.current.srcObject = null
    void viewer.watch(host, session.id, session.panes[0].id).catch(error => { if (request === watchRequest.current) report(error) }).finally(() => { if (request === watchRequest.current) setWatching(false) })
  }
  let leave = () => { ++watchRequest.current; viewer?.stop(); setSelectedId(''); setWatching(false); setState(undefined); setError(''); if (video.current) video.current.srcObject = null }
  let createService = (event: FormEvent) => { event.preventDefault(); void api('/api/services', { service: serviceName.trim() }).then(async (result) => { setCreatedKey(result.key); setKeyService(result.service); setServiceName(''); setServices(await api('/api/services')); setError('') }).catch(report) }
  let rotateService = (service: string) => { void api('/api/services/rotate', { service }).then(result => { setCreatedKey(result.key); setKeyService(result.service); setError('') }).catch(report) }
  let revokeService = (service: string) => { if (!window.confirm(`Revoke ${service} and disconnect its hosts?`)) return; void api('/api/services/revoke', { service }).then(async () => { setServices(await api('/api/services')); setError('') }).catch(report) }
  let saveGrant = (event: FormEvent) => { event.preventDefault(); void api('/api/grants', { service: grantService, user: grantUser.trim(), permission: grantPermission }).then(async () => { setGrants(await api('/api/grants')); setGrantUser(''); setError('') }).catch(report) }
  let removeGrant = (service: string, user: string) => { void api('/api/grants', { service, user, permission: null }).then(async () => setGrants(await api('/api/grants'))).catch(report) }
  let resize = () => { if (controlling && video.current) viewer?.send({ type: 'resize', generation: lease?.generation, width: Math.max(320, Math.min(1920, Math.round(video.current.clientWidth))), height: Math.max(200, Math.min(1080, Math.round(video.current.clientWidth * .625))) }) }
  let acquire = () => { if (session) viewer?.send({ type: 'acquire', session: session.id, takeover: !!lease }) }
  let release = () => { if (session) viewer?.send({ type: 'release', session: session.id }) }
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
  let showSessions = () => { inputDialog.current?.close(); leave(); setView('sessions') }
  return <main className={styles.main}>
    <header className={styles.header}><button className={styles.brand} onClick={() => { if (selected) leave(); setView(view === 'service' ? 'sessions' : 'service') }} aria-label="BMUX service"><img src="https://cdn.digthree.tonis.dev/bmux/website-5b317686c2a1/icon-128.png" alt="" /><span>bmux</span></button><span className={styles.headerLabel}>{view === 'service' ? 'Service' : selected ? 'Remote session' : 'Remote sessions'}</span><div ref={loginButton} className={viewer ? styles.hidden : undefined} /></header>
    {error && <p role="status" className={styles.error}>{error}</p>}
    {view === 'sessions' && !selected && <section className={styles.library}><div className={styles.sectionHeading}><span>AVAILABLE SESSIONS</span><span>{listed.length}</span></div>{viewer && listed.length === 0 && <p>No sessions available</p>}
      <div className={styles.sessions}>{listed.map(({ host, session, pane }) => <button key={`${host.id}:${session.id}`} className={styles.session} onClick={() => watch(host, session)}>
        <span className={styles.sessionIcon}><Icon name="sessions" /></span><span className={styles.sessionCopy}><strong>{session.name}</strong><small>{host.service} · {pane.title || 'Blank page'}</small></span><span className={styles.sessionArrow}>›</span>
      </button>)}</div>
    </section>}
    {view === 'sessions' && selected && <section className={styles.viewer}>
      <div className={styles.viewerToolbar}><button className={styles.iconButton} onClick={showSessions} aria-label="Sessions" title="Sessions"><Icon name="back" /></button>
        {state && <select className={styles.paneSelect} aria-label="Pane" value={state.pane} onChange={choosePane}>{state.sessions.flatMap(session => session.windows.flatMap(window => window.panes.map(pane => <option key={pane.id} value={pane.id}>{session.name} · {pane.title || pane.url || 'Blank page'}</option>)))}</select>}
        <span className={styles.status}>{watching ? 'Connecting' : controlling ? 'Controlling' : 'Watching'}</span>
        {selected.host.permission === 'control' && state && (controlling ? <button className={styles.controlButton} onClick={release}>Release control</button> : <button className={styles.controlButton} onClick={acquire}>{lease ? 'Take over' : 'Take control'}</button>)}
      </div>
      <video ref={video} className={styles.video} muted autoPlay playsInline tabIndex={0} data-viewport-width={viewport?.width} data-viewport-height={viewport?.height} onPointerDown={down} onPointerUp={up} onPointerMove={move} onWheel={scroll} onKeyDown={keyboard} onKeyUp={keyboard} aria-label="Remote browser" />
      {controlling && <div className={styles.controls}><div className={styles.controlGroup}><button className={styles.iconButton} onClick={back} aria-label="Back" title="Back"><Icon name="back" /></button><button className={styles.iconButton} onClick={forward} aria-label="Forward" title="Forward"><Icon name="forward" /></button><button className={styles.iconButton} onClick={reload} aria-label="Reload" title="Reload"><Icon name="reload" /></button></div><div className={styles.controlGroup}><button className={styles.iconButton} onClick={() => openInput('address')} aria-label="Open address" title="Open address"><Icon name="link" /></button><button className={styles.iconButton} onClick={() => openInput('text')} aria-label="Type into page" title="Type into page"><Icon name="type" /></button><button className={styles.iconButton} onClick={enter} aria-label="Enter" title="Enter"><Icon name="enter" /></button><button className={styles.iconButton} onClick={resize} aria-label="Fit viewport" title="Fit viewport"><Icon name="fit" /></button></div></div>}
    </section>}
    <dialog ref={inputDialog} className={styles.dialog} aria-label={inputMode === 'address' ? 'Open address' : 'Type into page'}><form onSubmit={inputMode === 'address' ? navigate : sendText}><div className={styles.dialogHeading}><strong>{inputMode === 'address' ? 'Open address' : 'Type into page'}</strong><button type="button" className={styles.iconButton} onClick={() => inputDialog.current?.close()} aria-label="Close"><Icon name="close" /></button></div><input ref={inputField} aria-label={inputMode === 'address' ? 'Address' : 'Text'} type={inputMode === 'address' ? 'url' : 'text'} value={inputMode === 'address' ? address : text} onChange={inputMode === 'address' ? changeAddress : changeText} placeholder={inputMode === 'address' ? 'https://example.com' : 'Enter text'} required /><button className={styles.primaryButton}>{inputMode === 'address' ? 'Go' : 'Type'}</button></form></dialog>
    {view === 'service' && <section className={styles.serviceView}><div className={styles.sectionHeading}><span>BMUX SERVICE</span><button onClick={() => setView('sessions')}>Sessions</button></div><h2>Service</h2>{viewer && <details><summary>Services and access</summary><p>Your account ID: <code>{owner}</code></p>
      <form className={styles.row} onSubmit={createService}><input aria-label="New service name" placeholder="Service name" value={serviceName} onChange={event => setServiceName(event.target.value)} required /><button>Create API key</button></form>
      {createdKey && <p>Save the key for {keyService} now. It is shown once: <code>{createdKey}</code><button onClick={() => setCreatedKey('')}>Dismiss</button></p>}
      {services.filter(service => !service.revoked).map(service => <p key={service.id}>{service.id} <button onClick={() => rotateService(service.id)}>Rotate key</button> <button onClick={() => revokeService(service.id)}>Revoke</button></p>)}
      {services.filter(service => !service.revoked).length > 0 && <form className={styles.row} onSubmit={saveGrant}>
        <select aria-label="Grant service" value={grantService} onChange={event => setGrantService(event.target.value)} required><option value="">Service</option>{services.filter(service => !service.revoked).map(service => <option key={service.id}>{service.id}</option>)}</select>
        <input aria-label="User account ID" placeholder="User account ID" value={grantUser} onChange={event => setGrantUser(event.target.value)} required />
        <select aria-label="Permission" value={grantPermission} onChange={event => setGrantPermission(event.target.value as 'watch' | 'control')}><option value="watch">Watch</option><option value="control">Control</option></select><button>Grant</button>
      </form>}
      {grants.map(grant => <p key={`${grant.service}:${grant.user_id}`}>{grant.service} · <code>{grant.user_id}</code> · {grant.permission} <button onClick={() => removeGrant(grant.service, grant.user_id)}>Remove</button></p>)}
    </details>}
    <div className={styles.usage}><h3>Usage <span>LAST 30 DAYS</span></h3>{usage.length ? <div className={styles.tableScroll}><table><thead><tr><th>Service</th><th>Started</th><th>Succeeded</th><th>Failed</th><th>Active minutes</th></tr></thead><tbody>{usage.map(item => <tr key={item.service}><td>{item.service}</td><td>{item.started}</td><td>{item.succeeded}</td><td>{item.failed}</td><td>{Math.round(item.browser_ms / 60000)}</td></tr>)}</tbody></table></div> : <p>No usage in the last 30 days.</p>}</div></section>}
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
