import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent, PointerEvent, WheelEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { createViewer } from '../../remote/web/client'
import type { Host, State } from '../../remote/web/client'
import css from './remote-client.module.css'

type Viewer = Awaited<ReturnType<typeof createViewer>>
type Selection = { origin: string; host: Host; session: string }
let bridge = (window as unknown as { remoteClient: { selection: () => Promise<Selection>; connect: (key: JsonWebKey) => Promise<{ ticket: string; iceServers: RTCIceServer[] }> } }).remoteClient

let App = () => {
  let [selection, setSelection] = useState<Selection>(), [hosts, setHosts] = useState<Host[]>([]), [viewer, setViewer] = useState<Viewer>(), [state, setState] = useState<State>()
  let [error, setError] = useState(''), [address, setAddress] = useState(''), [text, setText] = useState(''), [retry, setRetry] = useState(0)
  let video = useRef<HTMLVideoElement>(null), active = useRef<Viewer | undefined>(undefined), watching = useRef(false)
  useEffect(() => {
    let closed = false
    void bridge.selection().then(next => { if (!closed) setSelection(next) }).catch(error => setError(String(error)))
    return () => { closed = true; active.current?.close() }
  }, [])
  useEffect(() => {
    if (!selection) return
    let closed = false, reconnect: ReturnType<typeof setTimeout> | undefined
    void createViewer({
      hosts: setHosts,
      stream: stream => { if (video.current) { video.current.srcObject = stream; void video.current.play().catch(() => undefined) } },
      state: setState,
      error: setError,
      disconnected: () => { if (closed) return; setError('Connection lost. Reconnecting.'); setState(undefined); setViewer(undefined); setHosts([]); watching.current = false; reconnect = setTimeout(() => setRetry(value => value + 1), 2000) },
    }, { origin: selection.origin, connect: bridge.connect }).then(next => {
      if (closed) { next.close(); return }
      active.current = next; setViewer(next)
    }).catch(error => setError(error instanceof Error ? error.message : String(error)))
    return () => { closed = true; clearTimeout(reconnect); active.current?.close(); active.current = undefined }
  }, [selection, retry])
  useEffect(() => {
    if (!viewer || !selection || watching.current) return
    let host = hosts.find(item => item.id === selection.host.id)
    let session = host?.sessions.find(item => item.id === selection.session)
    if (!host || !session?.panes[0]) return
    watching.current = true
    void viewer.watch(host, session.id, session.panes[0].id).catch(error => setError(error instanceof Error ? error.message : String(error)))
  }, [viewer, hosts, selection])
  let session = state?.sessions.find(item => item.windows.some(window => window.panes.some(pane => pane.id === state.pane)))
  let pane = session?.windows.flatMap(window => window.panes).find(item => item.id === state?.pane)
  let lease = session && state?.controls[session.id], controlling = !!viewer && !!lease && lease.owner === viewer.id
  let viewport = state && state.viewports[state.pane]
  useEffect(() => { setAddress(pane?.url ?? '') }, [pane?.url])
  useEffect(() => {
    if (!viewer || !controlling || !session || !lease) return
    let timer = setInterval(() => viewer.send({ type: 'renew', session: session.id, generation: lease.generation }), 10000)
    return () => clearInterval(timer)
  }, [viewer, controlling, session?.id, lease?.generation])
  let acquire = () => { if (session) viewer?.send({ type: 'acquire', session: session.id, takeover: !!lease }) }
  let release = () => { if (session) viewer?.send({ type: 'release', session: session.id }) }
  let toggleControl = () => { if (controlling) release(); else acquire() }
  let command = (method: string, args: Record<string, unknown> = {}) => { if (controlling && state) viewer?.send({ type: 'command', generation: lease?.generation, command: { method, args: { tab: state.pane, ...args } } }) }
  let navigate = (event: FormEvent) => { event.preventDefault(); command('navigate', { url: address }) }
  let back = () => command('back'), forward = () => command('forward'), reload = () => command('reload')
  let changeAddress = (event: ChangeEvent<HTMLInputElement>) => setAddress(event.target.value)
  let changeText = (event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)
  let sendText = (event: FormEvent) => { event.preventDefault(); if (controlling && text) { viewer?.send({ type: 'text', generation: lease?.generation, text }); setText('') } }
  let choosePane = (event: ChangeEvent<HTMLSelectElement>) => viewer?.send({ type: 'switch', pane: event.target.value })
  let pointer = (event: PointerEvent<HTMLVideoElement> | WheelEvent<HTMLVideoElement>, type: string) => {
    if (!controlling || !video.current || !viewport || !video.current.videoWidth || !video.current.videoHeight) return
    event.preventDefault()
    let target = video.current, rect = target.getBoundingClientRect(), scale = Math.min(rect.width / target.videoWidth, rect.height / target.videoHeight)
    let x = (event.clientX - rect.left - (rect.width - target.videoWidth * scale) / 2) / scale
    let y = (event.clientY - rect.top - (rect.height - target.videoHeight * scale) / 2) / scale
    if (x < 0 || y < 0 || x > target.videoWidth || y > target.videoHeight) return
    viewer?.send({ type: 'input', generation: lease?.generation, viewportGeneration: viewport.generation, event: { type, x: Math.round(x * viewport.width / target.videoWidth), y: Math.round(y * viewport.height / target.videoHeight), button: event.button === 2 ? 'right' : 'left', clickCount: 1, ...(type === 'mouseWheel' ? { deltaX: (event as WheelEvent).deltaX, deltaY: (event as WheelEvent).deltaY } : {}) } })
  }
  let down = (event: PointerEvent<HTMLVideoElement>) => { event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); pointer(event, 'mouseDown') }
  let up = (event: PointerEvent<HTMLVideoElement>) => pointer(event, 'mouseUp')
  let move = (event: PointerEvent<HTMLVideoElement>) => pointer(event, 'mouseMove')
  let scroll = (event: WheelEvent<HTMLVideoElement>) => pointer(event, 'mouseWheel')
  let keyboard = (event: KeyboardEvent<HTMLVideoElement>) => {
    if (!controlling || !viewport || event.nativeEvent.isComposing) return
    event.preventDefault()
    let keyCode = ({ ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' } as Record<string, string>)[event.key] ?? event.key
    let modifiers = [event.shiftKey && 'shift', event.ctrlKey && 'control', event.altKey && 'alt', event.metaKey && 'meta'].filter(Boolean)
    viewer?.send({ type: 'input', generation: lease?.generation, viewportGeneration: viewport.generation, event: { type: event.type === 'keyup' ? 'keyUp' : event.key.length === 1 && !event.ctrlKey && !event.metaKey ? 'char' : 'keyDown', keyCode, modifiers } })
  }
  let close = () => window.close()
  return <main className={css.app}>
    <header className={css.bar}><strong>{session?.name ?? selection?.host.sessions.find(item => item.id === selection.session)?.name ?? 'Remote session'}</strong><span>{selection?.host.service}</span><button onClick={close}>Close</button></header>
    {error && <p className={css.error} role="status">{error}</p>}
    {state && <div className={css.bar}>
      <select aria-label="Pane" value={state.pane} onChange={choosePane}>{state.sessions.flatMap(item => item.windows.flatMap(window => window.panes.map(pane => <option key={pane.id} value={pane.id}>{item.name} · {pane.title || pane.url || 'Blank page'}</option>)))}</select>
      {selection?.host.permission === 'control' && <button onClick={toggleControl}>{controlling ? 'Release control' : lease ? 'Take over' : 'Take control'}</button>}
      <span>{controlling ? 'You control this session' : 'Watching'}</span>
    </div>}
    {controlling && <form className={css.bar} onSubmit={navigate}><button type="button" onClick={back}>Back</button><button type="button" onClick={forward}>Forward</button><button type="button" onClick={reload}>Reload</button><input aria-label="Address" value={address} onChange={changeAddress} /><button>Go</button></form>}
    <video ref={video} className={css.video} muted autoPlay playsInline tabIndex={0} onPointerDown={down} onPointerUp={up} onPointerMove={move} onWheel={scroll} onKeyDown={keyboard} onKeyUp={keyboard} aria-label="Remote browser" />
    {controlling && <form className={css.bar} onSubmit={sendText}><input aria-label="Type into page" value={text} onChange={changeText} /><button>Type</button></form>}
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
