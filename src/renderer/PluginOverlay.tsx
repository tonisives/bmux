import { conciseConfidence, pluginOverlaySummary } from '../shared/plugin-overlay'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import type { Bridge, PublicState } from '../shared/types'
import type { PluginOverlayControl, PluginOverlayState } from '../shared/plugin-overlay'
import css from './PluginOverlay.module.css'

export let PluginOverlay = () => {
  let [state, setState] = useState<PublicState>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [returnToSetup, setReturnToSetup] = useState(false)
  let [setting, openSetting] = useState<{ id: string }>()
  let drag = useRef<{x:number;y:number;bounds:PluginOverlayState['bounds'];edge:string} | undefined>(undefined), queued = useRef<Record<string, unknown> | undefined>(undefined), sending = useRef(false)
  useEffect(() => { void bridge.state().then(setState); return bridge.subscribe(setState) }, [])
  let overlay = state?.pluginOverlay
  let command = async (method: string, args: Record<string, unknown> = {}) => { try { setError(''); return await bridge.command({ method, args: { ...args, id: overlay?.runId } }) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Control failed') } }
  let input = async (id: string, value?: string | boolean) => { setBusy(true); await command('plugin.overlay.input', { control: id, value }); setBusy(false) }
  let stop = () => { setReturnToSetup(true); void input('stop') }
  useEffect(() => { setReturnToSetup(false); setError(''); openSetting(undefined) }, [overlay?.runId])
  useEffect(() => {
    if (overlay?.ended && returnToSetup) { setReturnToSetup(false); void command('plugin.overlay.configure') }
  }, [overlay?.ended, returnToSetup, command])
  let move = async () => { if (sending.current) return; sending.current = true; try { while (queued.current) { let bounds = queued.current; queued.current = undefined; await command('plugin.overlay.bounds', bounds) } } finally { sending.current = false } }
  let begin = (event: PointerEvent, edge = 'move') => { if (!overlay || (event.target as HTMLElement).closest('button,input,select,textarea')) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.screenX, y: event.screenY, bounds: overlay.bounds, edge }; event.preventDefault() }
  let update = (event: PointerEvent) => {
    let start = drag.current; if (!start) return
    let dx = event.screenX - start.x, dy = event.screenY - start.y
    let left = start.edge.includes('left'), resize = start.edge !== 'move'
    let width = Math.max(280, start.bounds.width + (left ? -dx : dx))
    queued.current = resize ? { ...start.bounds, x: left ? start.bounds.x + start.bounds.width - width : start.bounds.x, width, height: start.edge.startsWith('bottom') ? start.bounds.height + dy : start.bounds.height } : { ...start.bounds, x: start.bounds.x + dx, y: start.bounds.y + dy }
    void move()
  }
  let end = () => { drag.current = undefined }
  let beginResize = (event: PointerEvent<HTMLDivElement>) => begin(event, event.currentTarget.dataset.edge!)
  let resizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!overlay || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return
    event.preventDefault()
    let dx = event.key === 'ArrowRight' ? 24 : event.key === 'ArrowLeft' ? -24 : 0
    let left = event.currentTarget.dataset.edge?.includes('left')
    let width = Math.max(280, overlay.bounds.width + (left ? -dx : dx))
    void command('plugin.overlay.bounds', { ...overlay.bounds, x: left ? overlay.bounds.x + overlay.bounds.width - width : overlay.bounds.x, width, height: overlay.bounds.height + (event.key === 'ArrowDown' ? 24 : event.key === 'ArrowUp' ? -24 : 0) })
  }
  if (!overlay) return <aside className={css.empty}>Waiting for plugin status</aside>
  return <OverlayContext.Provider value={{ overlay, command, input, busy, stop, setting, openSetting }}><aside className={css.panel} data-compact={overlay.bounds.compact || undefined} data-collapsed={overlay.bounds.collapsed || undefined} aria-label="Page overlay">
    <OverlayHeader begin={begin} update={update} end={end} />
    {!overlay.bounds.collapsed && (error || overlay.error || overlay.content.error ? <OverlayFailure error={error || overlay.error} /> : overlay.bounds.compact ? <CompactOverlay /> : <OverlayBody />)}
    {!overlay.bounds.collapsed && !overlay.bounds.compact && <OverlayButtons failed={Boolean(error || overlay.error || overlay.content.error)} />}
    {!overlay.bounds.collapsed && !overlay.bounds.compact && ['left','right','bottom-left','bottom-right'].map(edge => <div key={edge} className={css.resize} data-edge={edge} role="slider" tabIndex={0} aria-label={edge === 'bottom-right' ? 'Resize page overlay' : 'Resize page overlay from ' + edge.replace('-', ' ')} aria-valuenow={overlay.bounds.width} onPointerDown={beginResize} onPointerMove={update} onPointerUp={end} onPointerCancel={end} onKeyDown={resizeKey} />)}
  </aside></OverlayContext.Provider>
}

type OverlayValue = { setting?: { id: string }; openSetting: (setting: { id: string }) => void; overlay: PluginOverlayState; command: (method:string,args?:Record<string,unknown>)=>Promise<unknown>; input:(id:string,value?:string|boolean)=>Promise<void>; busy:boolean; stop:()=>void }
let OverlayContext = createContext<OverlayValue | undefined>(undefined)
let useOverlay = () => { let value = useContext(OverlayContext); if (!value) throw new Error('Overlay unavailable'); return value }
let bridge = (window as unknown as { bmux: Bridge }).bmux
let OverlayHeader = ({ begin, update, end }: { begin:(event:PointerEvent)=>void;update:(event:PointerEvent)=>void;end:()=>void }) => {
  let { overlay, command } = useOverlay()
  let close = () => void command('plugin.overlay.close')
  let configure = () => void command('plugin.overlay.configure')
  let title = overlay.content.error?.title || (overlay.ended ? overlay.error || overlay.content.status.startsWith('Browsing stopped') ? 'Browsing stopped' : 'Session complete' : overlay.content.title)
  let minimize = () => void command('plugin.overlay.bounds', { ...overlay.bounds, compact: !overlay.bounds.collapsed, collapsed: !!overlay.bounds.compact && !overlay.bounds.collapsed })
  let small = overlay.bounds.compact || overlay.bounds.collapsed
  return <header onPointerDown={begin} onPointerMove={update} onPointerUp={end} onPointerCancel={end}>
    {small && !overlay.ended ? <CompactInformation inline={!!overlay.bounds.collapsed} /> : <div><strong>{title}</strong><span>{overlay.error || overlay.content.error ? overlay.ended ? 'Session ended' : 'Check the error below' : overlay.ended ? overlay.content.metrics : overlay.content.subtitle}</span></div>}
    <nav aria-label="Overlay controls">{overlay.ended && <button onClick={configure}>New session</button>}<button aria-label={overlay.bounds.collapsed ? 'Expand page overlay' : 'Minimize page overlay'} title={overlay.bounds.collapsed ? 'Show full overlay' : overlay.bounds.compact ? 'Minimize to one line' : 'Show compact overlay'} onClick={minimize}>{overlay.bounds.collapsed ? '+' : '_'}</button><button aria-label="Close overlay" onClick={close}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2 2 8 8m0-8-8 8" /></svg></button></nav>
  </header>
}
let CompactInformation = ({ inline = false }: { inline?: boolean }) => {
  let { overlay } = useOverlay(), summary = pluginOverlaySummary(overlay.content)
  return <div className={css.compactInformation}>
    <span className={css.decisions} aria-label="AI decision percentages" title={summary.decisions}>{summary.decisions}</span>
    {inline && <CompactAction concise />}
  </div>
}
let CompactAction = ({ concise = false }: { concise?: boolean }) => {
  let { overlay, input, busy } = useOverlay(), summary = pluginOverlaySummary(overlay.content)
  let control = overlay.content.controls.find(control => control.kind === 'button' && ['pause', 'resume', 'start'].includes(control.id))
  let click = () => { if (control) void input(control.id) }
  return <><span role="status" className={css.compactAction} title={summary.action}>{concise ? summary.action.replace(/^Watching: (\d+)s remaining$/, 'Watch $1s').replace('Moving to next post', 'Next post').replace('Checking creator profile', 'Creator profile') : summary.action}</span>{!overlay.ended && control && <button aria-label={control.label} title={control.label} disabled={busy || control.disabled} onClick={click}><svg viewBox="0 0 12 12" aria-hidden="true">{control.id === 'pause' ? <path d="M4 2v8M8 2v8" /> : <path d="m4 2 5 4-5 4Z" />}</svg></button>}</>
}
let CompactOverlay = () => <div className={css.compactBody} aria-label="Compact session status"><CompactAction /></div>
let OverlayBody = () => {
  let { overlay } = useOverlay()
  return <div className={css.body}>
    <p className={css.status} role="status">{overlay.ended ? overlay.error || overlay.content.status || 'Session ended' : overlay.content.status}</p>
    <p className={css.metrics}>{overlay.content.metrics}</p>
    <div className={css.nodes}>{overlay.content.nodes.map((node, index) => <OverlayNode key={index} node={node} copyable={index === overlay.content.nodes.length - 1} />)}</div>
    <OverlayDetails />
  </div>
}
let OverlayNode = ({ node, copyable }: { node:PluginOverlayState['content']['nodes'][number]; copyable:boolean }) => {
  let { overlay, command } = useOverlay(), [copied, setCopied] = useState('')
  let copy = async (event: MouseEvent<HTMLButtonElement>) => {
    let id = event.currentTarget.dataset.copy!
    let result = await command('plugin.overlay.copy', { copy: id }) as { copied?: boolean } | undefined
    if (result?.copied) { setCopied(id); setTimeout(() => setCopied(''), 2000) }
  }
  return <section data-tone={node.tone}><h2>{node.title}</h2>{node.lines.map(line => /\bAI\b|decision/i.test(node.title) ? conciseConfidence(line) : line).map((line, index) => <p key={index}>{line}</p>)}{copyable && <div className={css.copies}>{overlay.content.copies?.map(item => <button key={item.id} data-copy={item.id} onClick={copy}>{copied === item.id ? 'Copied' : item.label}</button>)}</div>}</section>
}
let OverlayButtons = ({ failed }: { failed: boolean }) => {
  let { overlay, command, busy, stop } = useOverlay()
  let configure = () => void command('plugin.overlay.configure')
  return <div className={css.controls}>{overlay.ended ? <button disabled={busy} onClick={configure}>Choose session settings</button> : overlay.content.controls.filter(control => control.kind === 'button' && (!failed || (overlay.content.error?.controls ?? ['resume', 'stop']).includes(control.id))).map(control => control.id === 'stop' ? <button key={control.id} disabled={busy || control.disabled} onClick={stop}>Stop session</button> : <OverlayButton key={control.id} control={control} />)}</div>
}
let OverlayButton = ({ control }: { control:PluginOverlayControl }) => {
  let { input, busy, openSetting } = useOverlay(), click = () => control.setting ? openSetting({ id: control.setting }) : void input(control.id)
  return <button disabled={busy || control.disabled} onClick={click}>{control.label}</button>
}
let OverlayDetails = () => {
  let { overlay, setting } = useOverlay(), [selected, setSelected] = useState('settings')
  let details = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (!setting || !details.current) return
    details.current.open = true; setSelected('settings')
  }, [setting])
  useEffect(() => {
    if (!setting || selected !== 'settings') return
    let frame = requestAnimationFrame(() => { let field = [...details.current!.querySelectorAll<HTMLElement>('[data-overlay-setting]')].find(field => field.dataset.overlaySetting === setting.id); field?.querySelector<HTMLElement>('input,select,textarea')?.focus(); field?.scrollIntoView({ block: 'nearest' }) })
    return () => cancelAnimationFrame(frame)
  }, [setting, selected])
  let sections = [...(!overlay.ended && overlay.content.controls.some(control => control.kind !== 'button') ? [{ id: 'settings', title: 'Session settings' }] : []), ...overlay.content.details.map((detail, index) => ({ id: String(index), title: detail.title }))]
  let current = sections.find(section => section.id === selected)?.id ?? sections[0]?.id
  let choose = (event: ChangeEvent<HTMLSelectElement>) => setSelected(event.target.value)
  if (!sections.length) return null
  return <details ref={details}><summary>Details and settings</summary><label className={css.field}>View<select aria-label="Page overlay detail" value={current} onChange={choose}>{sections.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label>{current === 'settings' ? overlay.content.controls.filter(control => control.kind !== 'button').map(control => <OverlayField key={control.id} control={control} />) : <pre>{overlay.content.details[Number(current)]?.text}</pre>}</details>
}
let OverlayField = ({ control }: { control: PluginOverlayControl }) => {
  let { input } = useOverlay(), [value, setValue] = useState(String(control.value ?? ''))
  useEffect(() => { setValue(String(control.value ?? '')) }, [control.value])
  let toggle = (event:ChangeEvent<HTMLInputElement>) => void input(control.id,event.target.checked)
  let choose = (event:ChangeEvent<HTMLSelectElement>) => void input(control.id,event.target.value)
  let change = (event:ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)
  let apply = () => void input(control.id,value)
  return <label className={css.field} data-kind={control.kind} data-overlay-setting={control.id}><span>{control.label}</span>{control.kind === 'toggle' ? <input type="checkbox" checked={control.value === true} disabled={control.disabled} onChange={toggle} /> : control.kind === 'choice' ? <select value={String(control.value)} disabled={control.disabled} onChange={choose}>{control.choices?.map(choice => <option key={choice}>{choice}</option>)}</select> : <><textarea value={value} maxLength={2000} disabled={control.disabled} onChange={change} /><button disabled={control.disabled || value === control.value} onClick={apply}>Apply</button></>}</label>
}


let OverlayFailure = ({ error }: { error?: string }) => {
  let { overlay, setting } = useOverlay()
  let failure = overlay.content.error
  let control = setting && overlay.content.controls.find(control => control.id === setting.id && control.kind !== 'button')
  let field = useRef<HTMLDivElement>(null)
  useEffect(() => { if (setting) field.current?.querySelector<HTMLElement>('select,input,textarea')?.focus() }, [setting])
  return <div className={`${css.body} ${css.failure}`}>
    <div role="alert"><h2>{error ? 'Plugin error' : failure?.title || 'Browsing stopped'}</h2><p>{error || failure?.message}</p>{failure?.diagnostic && <p className={css.diagnostic}>{failure.diagnostic}</p>}</div>
    {control && <div ref={field} className={css.recoverySettings}><OverlayField control={control} /><p>Changes are saved. Choose Resume when ready.</p></div>}
  </div>
}
