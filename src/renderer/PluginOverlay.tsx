import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { PublicState } from '../shared/types'
import type { PluginOverlayControl } from '../shared/plugin-overlay'
import css from './PluginOverlay.module.css'

export let PluginOverlay = () => {
  let [state, setState] = useState<PublicState>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirming, setConfirming] = useState(false)
  let drag = useRef<{x:number;y:number;bounds:NonNullable<PublicState['pluginOverlay']>['bounds'];resize:boolean} | undefined>(undefined), queued = useRef<Record<string, unknown> | undefined>(undefined), sending = useRef(false)
  useEffect(() => { void window.bmux.state().then(setState); return window.bmux.subscribe(setState) }, [])
  let overlay = state?.pluginOverlay
  let command = async (method: string, args: Record<string, unknown> = {}) => { try { setError(''); return await window.bmux.command({ method, args: { ...args, id: overlay?.runId } }) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Control failed') } }
  let input = async (id: string, value?: string | boolean) => { setBusy(true); await command('plugin.overlay.input', { control: id, value }); setBusy(false) }
  let move = async () => { if (sending.current) return; sending.current = true; try { while (queued.current) { let bounds = queued.current; queued.current = undefined; await command('plugin.overlay.bounds', bounds) } } finally { sending.current = false } }
  let begin = (event: PointerEvent, resize = false) => { if (!overlay || (event.target as HTMLElement).closest('button,input,select,textarea')) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.screenX, y: event.screenY, bounds: overlay.bounds, resize }; event.preventDefault() }
  let update = (event: PointerEvent) => { let start = drag.current; if (!start) return; let dx = event.screenX - start.x, dy = event.screenY - start.y; queued.current = start.resize ? { ...start.bounds, width: start.bounds.width + dx, height: start.bounds.height + dy } : { ...start.bounds, x: start.bounds.x + dx, y: start.bounds.y + dy }; void move() }
  let end = () => { drag.current = undefined }
  if (!overlay) return <aside className={css.empty}>Waiting for plugin status</aside>
  return <aside className={css.panel} aria-label="Plugin observer">
    <header onPointerDown={begin} onPointerMove={update} onPointerUp={end} onPointerCancel={end}><div><strong>{overlay.content.title}</strong><span>{overlay.content.subtitle}</span></div><button aria-label={overlay.bounds.collapsed ? 'Expand observer' : 'Collapse observer'} onClick={() => void command('plugin.overlay.bounds', { ...overlay.bounds, collapsed: !overlay.bounds.collapsed })}>{overlay.bounds.collapsed ? '+' : '−'}</button></header>
    {!overlay.bounds.collapsed && <><div className={css.body}><p className={css.status} role="status">{overlay.ended ? overlay.error || 'Session ended' : overlay.content.status}</p>
      <div className={css.nodes}>{overlay.content.nodes.map((node, index) => <section key={index} data-tone={node.tone}><h2>{node.title}</h2>{node.lines.map((line, n) => <p key={n}>{line}</p>)}</section>)}</div>
      <p className={css.metrics}>{overlay.content.metrics}</p>
      <div className={css.controls}>{!overlay.ended && overlay.content.controls.filter(control => control.kind === 'button').map(control => <button key={control.id} disabled={busy || control.disabled} onClick={() => void input(control.id)}>{control.label}</button>)}{overlay.ended && (confirming ? <><p>Prepare a new session? Browsing waits for Start.</p><button disabled={busy} onClick={() => void command('plugin.overlay.restart')}>Prepare session</button><button onClick={() => setConfirming(false)}>Back</button></> : <button onClick={() => setConfirming(true)}>Restart session</button>)}</div>
      {!overlay.ended && <details className={css.settings}><summary>Optimise this session</summary>{overlay.content.controls.filter(control => control.kind !== 'button').map(control => <OverlayField key={control.id} control={control} input={input} />)}</details>}
      {overlay.content.details.map((detail, index) => <details key={index}><summary>{detail.title}</summary><pre>{detail.text}</pre></details>)}
      {error && <p className={css.error} role="alert">{error}</p>}
    </div><div className={css.resize} role="slider" tabIndex={0} aria-label="Resize observer" aria-valuenow={overlay.bounds.width} onPointerDown={event => begin(event, true)} onPointerMove={update} onPointerUp={end} onPointerCancel={end} onKeyDown={event => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) { event.preventDefault(); void command('plugin.overlay.bounds', { ...overlay.bounds, width: overlay.bounds.width + (event.key === 'ArrowRight' ? 24 : event.key === 'ArrowLeft' ? -24 : 0), height: overlay.bounds.height + (event.key === 'ArrowDown' ? 24 : event.key === 'ArrowUp' ? -24 : 0) }) } }}>◢</div></>}
  </aside>
}
let OverlayField = ({ control, input }: { control: PluginOverlayControl; input: (id:string,value?:string|boolean)=>Promise<void> }) => {
  let [value, setValue] = useState(String(control.value ?? ''))
  useEffect(() => { setValue(String(control.value ?? '')) }, [control.value])
  return <label className={css.field}><span>{control.label}</span>{control.kind === 'toggle' ? <input type="checkbox" checked={control.value === true} disabled={control.disabled} onChange={event => void input(control.id, event.target.checked)} /> : control.kind === 'choice' ? <select value={String(control.value)} disabled={control.disabled} onChange={event => void input(control.id,event.target.value)}>{control.choices?.map(choice => <option key={choice}>{choice}</option>)}</select> : <><textarea value={value} maxLength={2000} disabled={control.disabled} onChange={event => setValue(event.target.value)} /><button disabled={control.disabled || value === control.value} onClick={() => void input(control.id,value)}>Apply</button></>}</label>
}
