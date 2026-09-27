import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, PointerEvent, WheelEvent, ChangeEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { api, createViewer } from './client'
import type { Host, State } from './client'
import styles from './style.module.css'

type Viewer = Awaited<ReturnType<typeof createViewer>>
let App = () => {
  let [viewer, setViewer] = useState<Viewer>(), [hosts, setHosts] = useState<Host[]>([]), [state, setState] = useState<State>()
  let [error, setError] = useState(''), [address, setAddress] = useState(''), [text, setText] = useState(''), [watching, setWatching] = useState(false)
  let [selectedId, setSelectedId] = useState(''), [usage, setUsage] = useState<{ service: string; started: number; succeeded: number; failed: number; browser_ms: number }[]>([])
  let [owner, setOwner] = useState(''), [services, setServices] = useState<{ id: string; revoked: boolean }[]>([])
  let [serviceName, setServiceName] = useState(''), [createdKey, setCreatedKey] = useState(''), [keyService, setKeyService] = useState('')
  let [grantService, setGrantService] = useState(''), [grantUser, setGrantUser] = useState(''), [grantPermission, setGrantPermission] = useState<'watch' | 'control'>('watch')
  let [grants, setGrants] = useState<{ service: string; user_id: string; permission: string }[]>([])
  let listed = hosts.flatMap(host => host.sessions.flatMap(session => session.panes.length ? [{ host, session, pane: session.panes[0] }] : []))
  let selected = listed.find(item => `${item.host.id}:${item.session.id}` === selectedId)
  let video = useRef<HTMLVideoElement>(null), loginButton = useRef<HTMLDivElement>(null), active = useRef<Viewer | undefined>(undefined), reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), watchRequest = useRef(0)
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
  let command = (method: string, args: Record<string, unknown> = {}) => { if (controlling && state) viewer?.send({ type: 'command', generation: lease?.generation, command: { method, args: { pane: state.pane, ...args } } }) }
  let navigate = (event: FormEvent) => { event.preventDefault(); command('navigate', { url: address }) }
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
  let sendText = (event: FormEvent) => { event.preventDefault(); if (controlling) { viewer?.send({ type: 'text', generation: lease?.generation, text }); setText('') } }
  return <main className={styles.main}>
    <header className={styles.header}><h1>bmux</h1><div ref={loginButton} className={viewer ? styles.hidden : undefined} /></header>
    {error && <p role="status">{error}</p>}
    {!selected && <section><h2>Sessions</h2>{viewer && listed.length === 0 && <p>No sessions available</p>}
      <div className={styles.sessions}>{listed.map(({ host, session, pane }) => <button key={`${host.id}:${session.id}`} className={styles.session} onClick={() => watch(host, session)}>
        <strong>{session.name}</strong><span>{host.service} · {pane.title || 'Blank page'}</span>
      </button>)}</div>
    </section>}
    {selected && <section className={styles.row}><button onClick={leave}>Sessions</button><strong>{selected.session.name}</strong>{watching && <span>Connecting</span>}</section>}
    {selected && state && <section className={styles.row}>
      <select aria-label="Pane" value={state.pane} onChange={choosePane}>{state.sessions.flatMap(session => session.windows.flatMap(window => window.panes.map(pane => <option key={pane.id} value={pane.id}>{session.name} · {pane.title || pane.url || 'Blank page'}</option>)))}</select>
      {selected.host.permission === 'control' && (controlling ? <button onClick={release}>Release control</button> : <button onClick={acquire}>{lease ? 'Take over' : 'Take control'}</button>)}
      <span>{controlling ? 'You control this session' : 'Watching'}</span>{controlling && <button onClick={resize}>Fit viewport</button>}
    </section>}
    {selected && controlling && <form className={styles.row} onSubmit={navigate}><button type="button" onClick={back}>Back</button><button type="button" onClick={forward}>Forward</button><button type="button" onClick={reload}>Reload</button><input aria-label="Address" value={address} onChange={changeAddress} /><button>Go</button></form>}
    {selected && <video ref={video} className={styles.video} muted autoPlay playsInline tabIndex={0} onPointerDown={down} onPointerUp={up} onPointerMove={move} onWheel={scroll} onKeyDown={keyboard} onKeyUp={keyboard} aria-label="Remote browser" />}
    {controlling && <form className={styles.row} onSubmit={sendText}><input aria-label="Type into page" value={text} onChange={changeText} /><button>Type</button><button type="button" onClick={enter}>Enter</button></form>}
    {viewer && !selected && <details><summary>Services and access</summary><p>Your account ID: <code>{owner}</code></p>
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
    {usage.length > 0 && <table><caption>Service usage · last 30 days</caption><thead><tr><th>Service</th><th>Started</th><th>Succeeded</th><th>Failed</th><th>Active minutes</th></tr></thead><tbody>{usage.map(item => <tr key={item.service}><td>{item.service}</td><td>{item.started}</td><td>{item.succeeded}</td><td>{item.failed}</td><td>{Math.round(item.browser_ms / 60000)}</td></tr>)}</tbody></table>}
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
