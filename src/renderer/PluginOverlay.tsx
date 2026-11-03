import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import type { Bridge, PublicState } from '../shared/types'
import type { PluginOverlayControl, PluginOverlayState } from '../shared/plugin-overlay'
import css from './PluginOverlay.module.css'

export let PluginOverlay = () => {
  let [state, setState] = useState<PublicState>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [returnToSetup, setReturnToSetup] = useState(false)
  let drag = useRef<{x:number;y:number;bounds:PluginOverlayState['bounds'];resize:boolean} | undefined>(undefined), queued = useRef<Record<string, unknown> | undefined>(undefined), sending = useRef(false)
  useEffect(() => { void bridge.state().then(setState); return bridge.subscribe(setState) }, [])
  let overlay = state?.pluginOverlay
  let command = async (method: string, args: Record<string, unknown> = {}) => { try { setError(''); return await bridge.command({ method, args: { ...args, id: overlay?.runId } }) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Control failed') } }
  let input = async (id: string, value?: string | boolean) => { setBusy(true); await command('plugin.overlay.input', { control: id, value }); setBusy(false) }
  let stop = () => { setReturnToSetup(true); void input('stop') }
  useEffect(() => { setReturnToSetup(false) }, [overlay?.runId])
  useEffect(() => {
    if (overlay?.ended && returnToSetup) { setReturnToSetup(false); void command('plugin.overlay.configure') }
  }, [overlay?.ended, returnToSetup, command])
  let move = async () => { if (sending.current) return; sending.current = true; try { while (queued.current) { let bounds = queued.current; queued.current = undefined; await command('plugin.overlay.bounds', bounds) } } finally { sending.current = false } }
  let begin = (event: PointerEvent, resize = false) => { if (!overlay || (event.target as HTMLElement).closest('button,input,select,textarea')) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.screenX, y: event.screenY, bounds: overlay.bounds, resize }; event.preventDefault() }
  let update = (event: PointerEvent) => { let start = drag.current; if (!start) return; let dx = event.screenX - start.x, dy = event.screenY - start.y; queued.current = start.resize ? { ...start.bounds, width: start.bounds.width + dx, height: start.bounds.height + dy } : { ...start.bounds, x: start.bounds.x + dx, y: start.bounds.y + dy }; void move() }
  let end = () => { drag.current = undefined }
  let beginResize = (event: PointerEvent) => begin(event, true)
  let resizeKey = (event: KeyboardEvent) => { if (!overlay || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return; event.preventDefault(); void command('plugin.overlay.bounds', { ...overlay.bounds, width: overlay.bounds.width + (event.key === 'ArrowRight' ? 24 : event.key === 'ArrowLeft' ? -24 : 0), height: overlay.bounds.height + (event.key === 'ArrowDown' ? 24 : event.key === 'ArrowUp' ? -24 : 0) }) }
  if (!overlay) return <aside className={css.empty}>Waiting for plugin status</aside>
  return <OverlayContext.Provider value={{ overlay, command, input, busy, stop }}><aside className={css.panel} aria-label="Page overlay">
    <OverlayHeader begin={begin} update={update} end={end} />
    {!overlay.bounds.collapsed && <OverlayBody error={error} />}
    {!overlay.bounds.collapsed && <OverlayButtons />}
    {!overlay.bounds.collapsed && <div className={css.resize} role="slider" tabIndex={0} aria-label="Resize page overlay" aria-valuenow={overlay.bounds.width} onPointerDown={beginResize} onPointerMove={update} onPointerUp={end} onPointerCancel={end} onKeyDown={resizeKey}>◢</div>}
  </aside></OverlayContext.Provider>
}

type OverlayValue = { overlay: PluginOverlayState; command: (method:string,args?:Record<string,unknown>)=>Promise<unknown>; input:(id:string,value?:string|boolean)=>Promise<void>; busy:boolean; stop:()=>void }
let OverlayContext = createContext<OverlayValue | undefined>(undefined)
let useOverlay = () => { let value = useContext(OverlayContext); if (!value) throw new Error('Overlay unavailable'); return value }
let bridge = (window as unknown as { bmux: Bridge }).bmux
let OverlayHeader = ({ begin, update, end }: { begin:(event:PointerEvent)=>void;update:(event:PointerEvent)=>void;end:()=>void }) => {
  let { overlay, command } = useOverlay()
  let close = () => void command('plugin.overlay.close')
  let configure = () => void command('plugin.overlay.configure')
  let title = overlay.ended ? overlay.error || overlay.content.status.startsWith('Browsing stopped') ? 'Browsing stopped' : 'Session complete' : overlay.content.title
  let collapse = () => void command('plugin.overlay.bounds', { ...overlay.bounds, collapsed: !overlay.bounds.collapsed })
  return <header onPointerDown={begin} onPointerMove={update} onPointerUp={end} onPointerCancel={end}><div><strong>{title}</strong><span>{overlay.ended ? overlay.content.metrics : overlay.content.subtitle}</span></div><nav aria-label="Overlay controls">{overlay.ended && <button onClick={configure}>New session</button>}<button aria-label={overlay.bounds.collapsed ? 'Expand page overlay' : 'Collapse page overlay'} onClick={collapse}>{overlay.bounds.collapsed ? '+' : '−'}</button><button aria-label="Close overlay" onClick={close}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2 2 8 8m0-8-8 8" /></svg></button></nav></header>
}
let OverlayBody = ({ error }: { error:string }) => {
  let { overlay } = useOverlay()
  return <div className={css.body}>
    <p className={css.status} role="status">{overlay.ended ? overlay.error || overlay.content.status || 'Session ended' : overlay.content.status}</p>
    <p className={css.metrics}>{overlay.content.metrics}</p>
    <div className={css.nodes}>{overlay.content.nodes.map((node, index) => <OverlayNode key={index} node={node} copyable={index === overlay.content.nodes.length - 1} />)}</div>
    <OverlayDetails />
    {error && <p className={css.error} role="alert">{error}</p>}
  </div>
}
let OverlayNode = ({ node, copyable }: { node:PluginOverlayState['content']['nodes'][number]; copyable:boolean }) => {
  let { overlay, command } = useOverlay(), [copied, setCopied] = useState('')
  let copy = async (event: MouseEvent<HTMLButtonElement>) => {
    let id = event.currentTarget.dataset.copy!
    let result = await command('plugin.overlay.copy', { copy: id }) as { copied?: boolean } | undefined
    if (result?.copied) { setCopied(id); setTimeout(() => setCopied(''), 2000) }
  }
  return <section data-tone={node.tone}><h2>{node.title}</h2>{node.lines.map((line, index) => <p key={index}>{line}</p>)}{copyable && <div className={css.copies}>{overlay.content.copies?.map(item => <button key={item.id} data-copy={item.id} onClick={copy}>{copied === item.id ? 'Copied' : item.label}</button>)}</div>}</section>
}
let OverlayButtons = () => {
  let { overlay, command, busy, stop } = useOverlay()
  let configure = () => void command('plugin.overlay.configure')
  return <div className={css.controls}>{overlay.ended ? <button disabled={busy} onClick={configure}>Choose session settings</button> : overlay.content.controls.filter(control => control.kind === 'button').map(control => control.id === 'stop' ? <button key={control.id} disabled={busy || control.disabled} onClick={stop}>Stop session</button> : <OverlayButton key={control.id} control={control} />)}</div>
}
let OverlayButton = ({ control }: { control:PluginOverlayControl }) => {
  let { input, busy } = useOverlay(), click = () => void input(control.id)
  return <button disabled={busy || control.disabled} onClick={click}>{control.label}</button>
}
let OverlayDetails = () => {
  let { overlay } = useOverlay(), [selected, setSelected] = useState('settings')
  let sections = [...(!overlay.ended && overlay.content.controls.some(control => control.kind !== 'button') ? [{ id: 'settings', title: 'Session settings' }] : []), ...overlay.content.details.map((detail, index) => ({ id: String(index), title: detail.title }))]
  let current = sections.find(section => section.id === selected)?.id ?? sections[0]?.id
  let choose = (event: ChangeEvent<HTMLSelectElement>) => setSelected(event.target.value)
  if (!sections.length) return null
  return <details><summary>Details and settings</summary><label className={css.field}>View<select aria-label="Page overlay detail" value={current} onChange={choose}>{sections.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label>{current === 'settings' ? overlay.content.controls.filter(control => control.kind !== 'button').map(control => <OverlayField key={control.id} control={control} />) : <pre>{overlay.content.details[Number(current)]?.text}</pre>}</details>
}
let OverlayField = ({ control }: { control: PluginOverlayControl }) => {
  let { input } = useOverlay(), [value, setValue] = useState(String(control.value ?? ''))
  useEffect(() => { setValue(String(control.value ?? '')) }, [control.value])
  let toggle = (event:ChangeEvent<HTMLInputElement>) => void input(control.id,event.target.checked)
  let choose = (event:ChangeEvent<HTMLSelectElement>) => void input(control.id,event.target.value)
  let change = (event:ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)
  let apply = () => void input(control.id,value)
  return <label className={css.field}><span>{control.label}</span>{control.kind === 'toggle' ? <input type="checkbox" checked={control.value === true} disabled={control.disabled} onChange={toggle} /> : control.kind === 'choice' ? <select value={String(control.value)} disabled={control.disabled} onChange={choose}>{control.choices?.map(choice => <option key={choice}>{choice}</option>)}</select> : <><textarea value={value} maxLength={2000} disabled={control.disabled} onChange={change} /><button disabled={control.disabled || value === control.value} onClick={apply}>Apply</button></>}</label>
}
