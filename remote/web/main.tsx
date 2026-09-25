import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, PointerEvent, WheelEvent, ChangeEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { api, createViewer } from './client'
import type { Host, State } from './client'
import styles from './style.module.css'

type Viewer = Awaited<ReturnType<typeof createViewer>>
let App = () => {
  let [viewer, setViewer] = useState<Viewer>(), [hosts, setHosts] = useState<Host[]>([]), [state, setState] = useState<State>()
  let [error, setError] = useState(''), [address, setAddress] = useState(''), [text, setText] = useState(''), [trusted, setTrusted] = useState('')
  let [selected, setSelected] = useState<Host>(), [usage, setUsage] = useState<{ service: string; started: number; succeeded: number; failed: number; browser_ms: number }[]>([])
  let video = useRef<HTMLVideoElement>(null), loginButton = useRef<HTMLDivElement>(null), active = useRef<Viewer | undefined>(undefined)
  let viewport = state && state.viewports[state.pane]
  let session = state?.sessions.find(session => session.windows.some(window => window.panes.some(pane => pane.id === state.pane)))
  let lease = session && state?.controls[session.id], controlling = lease?.owner === viewer?.id
  let report = (error: unknown) => setError(error instanceof Error ? error.message : 'Operation failed')
  let connect = async () => {
    active.current?.close(); setState(undefined); setError('')
    let next = await createViewer({ hosts: setHosts, stream: stream => { if (video.current) { video.current.srcObject = stream; void video.current.play().catch(() => undefined) } }, state: setState, error: setError, disconnected: () => { setState(undefined); setError('Disconnected. Reconnect to continue.') } })
    active.current = next; setViewer(next)
    setUsage(await api('/api/usage'))
  }
  useEffect(() => {
    let cancelled = false
    let script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true
    script.onload = () => {
      void api('/api/config').then(config => {
        if (cancelled) return
        let google = (window as any).google
        google.accounts.id.initialize({ client_id: config.googleClientId, callback: (response: { credential: string }) => { void api('/api/login', response).then(connect).catch(report) } })
        google.accounts.id.renderButton(loginButton.current, { theme: 'outline', size: 'large' })
      }).catch(report)
    }
    document.head.append(script)
    return () => { cancelled = true; active.current?.close(); script.remove() }
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
  let reconnect = () => { void connect().catch(report) }
  let chooseHost = (event: ChangeEvent<HTMLSelectElement>) => { let host = hosts.find(host => host.id === event.target.value); setSelected(host); setTrusted(host ? localStorage.getItem(`bmux-trust-${host.service}`) ?? '' : '') }
  let watch = () => {
    if (!viewer || !selected) return
    void viewer.watch(selected, trusted.trim()).then(() => { localStorage.setItem(`bmux-trust-${selected.service}`, trusted.trim()); setError('') }).catch(report)
  }
  let downloadKey = () => {
    if (!viewer) return
    let url = URL.createObjectURL(new Blob([JSON.stringify(viewer.publicKey, null, 2)], { type: 'application/json' }))
    let anchor = document.createElement('a'); anchor.href = url; anchor.download = 'bmux-viewer-public-key.json'; anchor.click(); URL.revokeObjectURL(url)
  }
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
  let changeTrusted = (event: ChangeEvent<HTMLInputElement>) => setTrusted(event.target.value)
  let changeAddress = (event: ChangeEvent<HTMLInputElement>) => setAddress(event.target.value)
  let changeText = (event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)
  let enter = () => command('key', { key: 'Enter' })
  let sendText = (event: FormEvent) => { event.preventDefault(); if (controlling) { viewer?.send({ type: 'text', generation: lease?.generation, text }); setText('') } }
  return <main className={styles.main}>
    <header className={styles.header}><h1>bmux</h1><div ref={loginButton} /><button onClick={reconnect}>Reconnect</button></header>
    {error && <p role="status">{error}</p>}
    {viewer && <details><summary>Device pairing</summary><p>Approve this device on the host before watching.</p><code>{viewer.id}</code><button onClick={downloadKey}>Download public key</button></details>}
    <section className={styles.row}>
      <select aria-label="Host" onChange={chooseHost} value={selected?.id ?? ''}><option value="">Choose host</option>{hosts.map(host => <option key={host.id} value={host.id}>{host.service} · {host.id.slice(0,8)}</option>)}</select>
      <input aria-label="Trusted host fingerprint" placeholder="Host fingerprint from enrollment" value={trusted} onChange={changeTrusted} />
      <button onClick={watch} disabled={!selected || !viewer}>Watch</button>
    </section>
    {state && <section className={styles.row}>
      <select aria-label="Pane" value={state.pane} onChange={choosePane}>{state.sessions.flatMap(session => session.windows.flatMap(window => window.panes.map(pane => <option key={pane.id} value={pane.id}>{session.name} · {pane.title || pane.url || 'Blank page'}</option>)))}</select>
      {controlling ? <button onClick={release}>Release control</button> : <button onClick={acquire}>{lease ? 'Take over' : 'Take control'}</button>}
      <span>{controlling ? 'You control this session' : 'Watching'}</span>{controlling && <button onClick={resize}>Fit viewport</button>}
    </section>}
    {controlling && <form className={styles.row} onSubmit={navigate}><button type="button" onClick={back}>Back</button><button type="button" onClick={forward}>Forward</button><button type="button" onClick={reload}>Reload</button><input aria-label="Address" value={address} onChange={changeAddress} /><button>Go</button></form>}
    <video ref={video} className={styles.video} muted autoPlay playsInline tabIndex={0} onPointerDown={down} onPointerUp={up} onPointerMove={move} onWheel={scroll} onKeyDown={keyboard} onKeyUp={keyboard} aria-label="Remote browser" />
    {controlling && <form className={styles.row} onSubmit={sendText}><input aria-label="Type into page" value={text} onChange={changeText} /><button>Type</button><button type="button" onClick={enter}>Enter</button></form>}
    {usage.length > 0 && <table><caption>Service usage · last 30 days</caption><thead><tr><th>Service</th><th>Started</th><th>Succeeded</th><th>Failed</th><th>Active minutes</th></tr></thead><tbody>{usage.map(item => <tr key={item.service}><td>{item.service}</td><td>{item.started}</td><td>{item.succeeded}</td><td>{item.failed}</td><td>{Math.round(item.browser_ms / 60000)}</td></tr>)}</tbody></table>}
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
