import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
import type { RemoteViewAction, RemoteViewUpdate } from '../shared/remote'
import { createRoot } from 'react-dom/client'
import { createViewer } from '../../remote/web/client'
import type { Host, State } from '../../remote/web/client'
import './global.css'
import css from './remote-client.module.css'

type Viewer = Awaited<ReturnType<typeof createViewer>>
type Selection = { origin: string; host: Host; session: string }
let bridge = (window as unknown as { remoteClient: { preview: (pane: string, image: string) => Promise<void>; update: (state: RemoteViewUpdate) => Promise<void>; actions: (listener: (action: RemoteViewAction) => void) => () => void; close: () => Promise<void>; selection: () => Promise<Selection>; connect: (key: JsonWebKey) => Promise<{ ticket: string; iceServers: RTCIceServer[] }> } }).remoteClient

let useRemotePreview = (video: RefObject<HTMLVideoElement | null>, pane?: string) => {
  useEffect(() => {
    let target = video.current
    if (!target || !pane) return
    let callback = 0, captured = 0
    let frame = () => {
      if (target.readyState >= 2 && target.videoWidth && target.videoHeight && Date.now() - captured >= 15000) {
        let canvas = document.createElement('canvas'), scale = Math.min(1, 960 / target.videoWidth, 720 / target.videoHeight)
        canvas.width = Math.round(target.videoWidth * scale); canvas.height = Math.round(target.videoHeight * scale)
        let context = canvas.getContext('2d')
        if (context) {
          context.drawImage(target, 0, 0, canvas.width, canvas.height)
          void bridge.preview(pane, canvas.toDataURL('image/jpeg', .65)).catch(() => undefined)
          captured = Date.now()
        }
      }
      callback = target.requestVideoFrameCallback(frame)
    }
    callback = target.requestVideoFrameCallback(frame)
    return () => target.cancelVideoFrameCallback(callback)
  }, [pane])
}

let App = () => {
  let [selection, setSelection] = useState<Selection>(), [hosts, setHosts] = useState<Host[]>([]), [viewer, setViewer] = useState<Viewer>(), [state, setState] = useState<State>()
  let [error, setError] = useState(''), [retry, setRetry] = useState(0)
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
      stream: stream => { setState(undefined); if (video.current) { video.current.srcObject = stream; void video.current.play().catch(() => undefined) } },
      state: next => { setState(next); setError('') },
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
  let lease = session && state?.controls[session.id], controlling = !!viewer && !!lease && lease.owner === viewer.id
  let viewport = state && state.viewports[state.pane]
  useRemotePreview(video, state?.pane)
  useEffect(() => {
    if (!selection) return
    void bridge.update({ name: session?.name ?? selection.host.sessions.find(item => item.id === selection.session)?.name ?? 'Remote', connected: !!state, controlling, occupied: !!lease, pane: state?.pane, panes: session?.windows.flatMap(window => window.panes) ?? [], error }).catch(() => undefined)
  }, [selection, session, state, controlling, lease, error])
  useEffect(() => bridge.actions(action => {
    if (!viewer) return
    if (action.type === 'switch') { setState(undefined); if (video.current) video.current.srcObject = null; viewer.send({ type: 'switch', pane: action.pane }); return }
    if (!session) return
    if (action.type === 'acquire') viewer.send({ type: 'acquire', session: session.id, takeover: !!lease })
    else if (action.type === 'release') viewer.send({ type: 'release', session: session.id })
    else if (action.type === 'command' && controlling && state) viewer.send({ type: 'command', generation: lease?.generation, command: { method: action.method, args: { ...action.args, tab: state.pane } } })
  }), [viewer, session, lease, controlling, state])
  useEffect(() => {
    if (!viewer || !controlling || !session || !lease) return
    let timer = setInterval(() => viewer.send({ type: 'renew', session: session.id, generation: lease.generation }), 10000)
    return () => clearInterval(timer)
  }, [viewer, controlling, session?.id, lease?.generation])
  let pointer = useCallback((event: PointerEvent<HTMLVideoElement> | WheelEvent, type: string) => {
    if (!controlling || !video.current || !viewport || !video.current.videoWidth || !video.current.videoHeight) return
    event.preventDefault()
    let target = video.current, rect = target.getBoundingClientRect(), scale = Math.min(rect.width / target.videoWidth, rect.height / target.videoHeight)
    let x = (event.clientX - rect.left - (rect.width - target.videoWidth * scale) / 2) / scale
    let y = (event.clientY - rect.top - (rect.height - target.videoHeight * scale) / 2) / scale
    if (x < 0 || y < 0 || x > target.videoWidth || y > target.videoHeight) return
    viewer?.send({ type: 'input', generation: lease?.generation, viewportGeneration: viewport.generation, event: { type, x: Math.round(x * viewport.width / target.videoWidth), y: Math.round(y * viewport.height / target.videoHeight), button: event.button === 2 ? 'right' : 'left', clickCount: 1, ...(type === 'mouseWheel' ? { deltaX: (event as WheelEvent).deltaX, deltaY: (event as WheelEvent).deltaY } : {}) } })
  }, [controlling, viewer, viewport, lease?.generation])
  useEffect(() => {
    let target = video.current
    if (!target) return
    let scroll = (event: WheelEvent) => pointer(event, 'mouseWheel')
    target.addEventListener('wheel', scroll, { passive: false })
    return () => target.removeEventListener('wheel', scroll)
  }, [pointer])
  let down = (event: PointerEvent<HTMLVideoElement>) => { event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); pointer(event, 'mouseDown') }
  let up = (event: PointerEvent<HTMLVideoElement>) => pointer(event, 'mouseUp')
  let move = (event: PointerEvent<HTMLVideoElement>) => pointer(event, 'mouseMove')
  let keyboard = (event: KeyboardEvent<HTMLVideoElement>) => {
    if (!controlling || !viewport || event.nativeEvent.isComposing) return
    event.preventDefault()
    let keyCode = ({ ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' } as Record<string, string>)[event.key] ?? event.key
    let modifiers = [event.shiftKey && 'shift', event.ctrlKey && 'control', event.altKey && 'alt', event.metaKey && 'meta'].filter(Boolean)
    viewer?.send({ type: 'input', generation: lease?.generation, viewportGeneration: viewport.generation, event: { type: event.type === 'keyup' ? 'keyUp' : event.key.length === 1 && !event.ctrlKey && !event.metaKey ? 'char' : 'keyDown', keyCode, modifiers } })
  }
  return <main className={css.viewport} role="region" aria-label="Remote viewport">
    <video ref={video} className={css.video} width={viewport?.width} height={viewport?.height} muted autoPlay playsInline tabIndex={0} onPointerDown={down} onPointerUp={up} onPointerMove={move} onKeyDown={keyboard} onKeyUp={keyboard} aria-label="Remote browser" />
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
