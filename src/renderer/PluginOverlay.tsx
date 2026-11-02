import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, PointerEvent } from 'react'
import type { Bridge, PublicState } from '../shared/types'
import type { PluginOverlayControl, PluginOverlayState } from '../shared/plugin-overlay'
import css from './PluginOverlay.module.css'

export let PluginOverlay = () => {
  let [state, setState] = useState<PublicState>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  let drag = useRef<{x:number;y:number;bounds:PluginOverlayState['bounds'];resize:boolean} | undefined>(undefined), queued = useRef<Record<string, unknown> | undefined>(undefined), sending = useRef(false)
  useEffect(() => { void bridge.state().then(setState); return bridge.subscribe(setState) }, [])
  let overlay = state?.pluginOverlay
  let command = async (method: string, args: Record<string, unknown> = {}) => { try { setError(''); return await bridge.command({ method, args: { ...args, id: overlay?.runId } }) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Control failed') } }
  let input = async (id: string, value?: string | boolean) => { setBusy(true); await command('plugin.overlay.input', { control: id, value }); setBusy(false) }
  let move = async () => { if (sending.current) return; sending.current = true; try { while (queued.current) { let bounds = queued.current; queued.current = undefined; await command('plugin.overlay.bounds', bounds) } } finally { sending.current = false } }
  let begin = (event: PointerEvent, resize = false) => { if (!overlay || (event.target as HTMLElement).closest('button,input,select,textarea')) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.screenX, y: event.screenY, bounds: overlay.bounds, resize }; event.preventDefault() }
  let update = (event: PointerEvent) => { let start = drag.current; if (!start) return; let dx = event.screenX - start.x, dy = event.screenY - start.y; queued.current = start.resize ? { ...start.bounds, width: start.bounds.width + dx, height: start.bounds.height + dy } : { ...start.bounds, x: start.bounds.x + dx, y: start.bounds.y + dy }; void move() }
  let end = () => { drag.current = undefined }
  let beginResize = (event: PointerEvent) => begin(event, true)
  let resizeKey = (event: KeyboardEvent) => { if (!overlay || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return; event.preventDefault(); void command('plugin.overlay.bounds', { ...overlay.bounds, width: overlay.bounds.width + (event.key === 'ArrowRight' ? 24 : event.key === 'ArrowLeft' ? -24 : 0), height: overlay.bounds.height + (event.key === 'ArrowDown' ? 24 : event.key === 'ArrowUp' ? -24 : 0) }) }
  if (!overlay) return <aside className={css.empty}>Waiting for plugin status</aside>
  return <ObserverContext.Provider value={{ overlay, command, input, busy }}><aside className={css.panel} aria-label="Plugin observer">
    <ObserverHeader begin={begin} update={update} end={end} />
    {!overlay.bounds.collapsed && <ObserverBody error={error} />}
    {!overlay.bounds.collapsed && <div className={css.resize} role="slider" tabIndex={0} aria-label="Resize observer" aria-valuenow={overlay.bounds.width} onPointerDown={beginResize} onPointerMove={update} onPointerUp={end} onPointerCancel={end} onKeyDown={resizeKey}>◢</div>}
  </aside></ObserverContext.Provider>
}

type ObserverValue = { overlay: PluginOverlayState; command: (method:string,args?:Record<string,unknown>)=>Promise<unknown>; input:(id:string,value?:string|boolean)=>Promise<void>; busy:boolean }
let ObserverContext = createContext<ObserverValue | undefined>(undefined)
let useObserver = () => { let value = useContext(ObserverContext); if (!value) throw new Error('Observer unavailable'); return value }
let bridge = (window as unknown as { bmux: Bridge }).bmux
let ObserverHeader = ({ begin, update, end }: { begin:(event:PointerEvent)=>void;update:(event:PointerEvent)=>void;end:()=>void }) => {
  let { overlay, command } = useObserver()
  let collapse = () => void command('plugin.overlay.bounds', { ...overlay.bounds, collapsed: !overlay.bounds.collapsed })
  return <header onPointerDown={begin} onPointerMove={update} onPointerUp={end} onPointerCancel={end}><div><strong>{overlay.content.title}</strong><span>{overlay.content.subtitle}</span></div><button aria-label={overlay.bounds.collapsed ? 'Expand observer' : 'Collapse observer'} onClick={collapse}>{overlay.bounds.collapsed ? '+' : '−'}</button></header>
}
let ObserverBody = ({ error }: { error:string }) => {
  let { overlay } = useObserver()
  return <div className={css.body}>
    <p className={css.status} role="status">{overlay.ended ? overlay.error || 'Session ended' : overlay.content.status}</p>
    <div className={css.nodes}>{overlay.content.nodes.map((node, index) => <ObserverNode key={index} node={node} />)}</div>
    <p className={css.metrics}>{overlay.content.metrics}</p>
    <ObserverButtons />
    {!overlay.ended && <ObserverSettings />}
    {overlay.content.details.map((detail, index) => <details key={index}><summary>{detail.title}</summary><pre>{detail.text}</pre></details>)}
    {error && <p className={css.error} role="alert">{error}</p>}
  </div>
}
let ObserverNode = ({ node }: { node:PluginOverlayState['content']['nodes'][number] }) => <section data-tone={node.tone}><h2>{node.title}</h2>{node.lines.map((line, index) => <p key={index}>{line}</p>)}</section>
let ObserverButtons = () => {
  let { overlay, command, busy } = useObserver(), [confirming, setConfirming] = useState(false)
  useEffect(() => setConfirming(false), [overlay.runId])
  let confirm = () => setConfirming(true), back = () => setConfirming(false), restart = () => void command('plugin.overlay.restart')
  return <div className={css.controls}>{overlay.ended ? confirming ? <><p>Prepare a new session? Browsing waits for Start.</p><button disabled={busy} onClick={restart}>Prepare session</button><button onClick={back}>Back</button></> : <button onClick={confirm}>Restart session</button> : overlay.content.controls.filter(control => control.kind === 'button').map(control => <ObserverButton key={control.id} control={control} />)}</div>
}
let ObserverButton = ({ control }: { control:PluginOverlayControl }) => {
  let { input, busy } = useObserver(), click = () => void input(control.id)
  return <button disabled={busy || control.disabled} onClick={click}>{control.label}</button>
}
let ObserverSettings = () => {
  let { overlay } = useObserver()
  return <details className={css.settings}><summary>Optimise this session</summary>{overlay.content.controls.filter(control => control.kind !== 'button').map(control => <OverlayField key={control.id} control={control} />)}</details>
}
let OverlayField = ({ control }: { control: PluginOverlayControl }) => {
  let { input } = useObserver(), [value, setValue] = useState(String(control.value ?? ''))
  useEffect(() => { setValue(String(control.value ?? '')) }, [control.value])
  let toggle = (event:ChangeEvent<HTMLInputElement>) => void input(control.id,event.target.checked)
  let choose = (event:ChangeEvent<HTMLSelectElement>) => void input(control.id,event.target.value)
  let change = (event:ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)
  let apply = () => void input(control.id,value)
  return <label className={css.field}><span>{control.label}</span>{control.kind === 'toggle' ? <input type="checkbox" checked={control.value === true} disabled={control.disabled} onChange={toggle} /> : control.kind === 'choice' ? <select value={String(control.value)} disabled={control.disabled} onChange={choose}>{control.choices?.map(choice => <option key={choice}>{choice}</option>)}</select> : <><textarea value={value} maxLength={2000} disabled={control.disabled} onChange={change} /><button disabled={control.disabled || value === control.value} onClick={apply}>Apply</button></>}</label>
}
