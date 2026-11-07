import { conciseConfidence, pluginOverlaySummary } from '../shared/plugin-overlay'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import type { Bridge } from '../shared/types'
import type { PluginOverlayControl, PluginOverlayState, PaneOverlayTab } from '../shared/plugin-overlay'
import css from './PluginOverlay.module.css'
import appCss from './App.module.css'
import bmuxIcon from './bmux-icon.png'

export let PluginOverlay = () => {
  let [overlay, setOverlay] = useState<PluginOverlayState>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [returnToSetup, setReturnToSetup] = useState(false)
  let [setting, openSetting] = useState<{ id: string; runId: string }>()
  let drag = useRef<{x:number;y:number;bounds:PluginOverlayState['bounds'];edge:string} | undefined>(undefined), queued = useRef<Record<string, unknown> | undefined>(undefined), sending = useRef(false)
  useEffect(() => { let unsubscribe = bridge.subscribeOverlay(setOverlay); void bridge.overlayState().then(setOverlay); return unsubscribe }, [])
  let command = async (method: string, args: Record<string, unknown> = {}) => { try { setError(''); return await bridge.command({ method, args: { ...args, id: overlay?.runId, pane: overlay?.paneId } }) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Control failed') } }
  let input = async (id: string, value?: string | boolean) => { setBusy(true); await command('plugin.overlay.input', { control: id, value }); setBusy(false) }
  let stop = () => { setReturnToSetup(true); void input('stop') }
  useEffect(() => { setReturnToSetup(false); setError(''); openSetting(undefined) }, [overlay?.runId])
  useEffect(() => {
    if (overlay?.ended && returnToSetup) { setReturnToSetup(false); void command('plugin.overlay.configure') }
  }, [overlay?.ended, returnToSetup, command])
  let move = async () => { if (sending.current) return; sending.current = true; try { while (queued.current) { let bounds = queued.current; queued.current = undefined; await command('pane.overlay.bounds', bounds) } } finally { sending.current = false } }
  let begin = (event: PointerEvent, edge = 'move') => { if (!overlay || (event.target as HTMLElement).closest('button,input,select,textarea')) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.screenX, y: event.screenY, bounds: overlay.bounds, edge }; event.preventDefault() }
  let update = (event: PointerEvent) => {
    let start = drag.current; if (!start) return
    let dx = event.screenX - start.x, dy = event.screenY - start.y, zoom = overlay?.zoom ?? 1
    let left = start.edge.includes('left'), resize = start.edge !== 'move'
    let width = Math.max(280, start.bounds.width + (left ? -dx : dx) / zoom)
    queued.current = resize ? { ...start.bounds, x: left ? start.bounds.x + (start.bounds.width - width) * zoom : start.bounds.x, width, y: start.edge.startsWith('top') ? start.bounds.y + Math.min(dy, (start.bounds.height - 240) * zoom) : start.bounds.y, height: start.edge.startsWith('top') ? Math.max(240, start.bounds.height - dy / zoom) : start.edge.startsWith('bottom') ? start.bounds.height + dy / zoom : start.bounds.height } : { ...start.bounds, x: start.bounds.x + dx, y: start.bounds.y + dy }
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
    void command('pane.overlay.bounds', { ...overlay.bounds, x: left ? overlay.bounds.x + (overlay.bounds.width - width) * overlay.zoom : overlay.bounds.x, width, height: Math.max(240, overlay.bounds.height + (event.key === 'ArrowDown' ? -24 : event.key === 'ArrowUp' ? 24 : 0)), y: overlay.bounds.y + (event.key === 'ArrowDown' ? Math.min(24 * overlay.zoom, (overlay.bounds.height - 240) * overlay.zoom) : event.key === 'ArrowUp' ? -24 * overlay.zoom : 0) })
  }
  let panelKeys = (event: KeyboardEvent) => { if (event.key === 'Escape' && overlay && !overlay.bounds.collapsed) { event.stopPropagation(); void command('pane.overlay.bounds', { ...overlay.bounds, collapsed: true, compact: false }) } }
  if (!overlay) return <aside className={css.empty}>Waiting for plugin status</aside>
  return <OverlayContext.Provider value={{ overlay, command, input, busy, stop, setting: setting?.runId === overlay.runId ? setting : undefined, openSetting: target => openSetting({ ...target, runId: overlay.runId }) }}><aside id="pane-panel" role="tabpanel" className={css.panel} data-compact={overlay.bounds.compact || undefined} data-collapsed={overlay.bounds.collapsed || undefined} aria-label="Page overlay" onKeyDown={panelKeys}>
    <OverlayTabs begin={begin} update={update} end={end} />
    {!overlay.bounds.collapsed && (overlay.selectedTab === 'agent' ? <AgentPanel /> : overlay.selectedTab === 'viewport' ? <ViewportPanel /> : error || overlay.error || overlay.content.error ? <OverlayFailure error={error || overlay.error} /> : overlay.bounds.compact ? <CompactOverlay /> : overlay.content.decision ? <DecisionBody /> : <OverlayBody />)}
    {!overlay.bounds.collapsed && !overlay.bounds.compact && !['agent','viewport'].includes(overlay.selectedTab ?? '') && (!overlay.content.decision || overlay.content.controls.some(control => ['start','continue','auto'].includes(control.id)) || Boolean(error || overlay.error || overlay.content.error)) && <OverlayButtons failed={Boolean(error || overlay.error || overlay.content.error)} />}
    {!overlay.bounds.collapsed && !overlay.bounds.compact && ['top-right'].map(edge => <div key={edge} className={css.resize} data-edge={edge} role="slider" tabIndex={0} aria-label={edge === 'top-right' ? 'Resize page overlay' : 'Resize page overlay from ' + edge.replace('-', ' ')} aria-valuenow={overlay.bounds.width} onPointerDown={beginResize} onPointerMove={update} onPointerUp={end} onPointerCancel={end} onKeyDown={resizeKey} />)}
  </aside></OverlayContext.Provider>
}

type OverlayValue = { setting?: { id: string }; openSetting: (setting: { id: string }) => void; overlay: PluginOverlayState; command: (method:string,args?:Record<string,unknown>)=>Promise<unknown>; input:(id:string,value?:string|boolean)=>Promise<void>; busy:boolean; stop:()=>void }
let OverlayContext = createContext<OverlayValue | undefined>(undefined)
let useOverlay = () => { let value = useContext(OverlayContext); if (!value) throw new Error('Overlay unavailable'); return value }
let bridge = (window as unknown as { bmux: Bridge }).bmux
let OverlayTabs = ({ begin, update, end }: { begin:(event:PointerEvent)=>void;update:(event:PointerEvent)=>void;end:()=>void }) => {
  let { overlay, command } = useOverlay()
  let tabs = overlay.tabs ?? [{ id: overlay.runId, title: overlay.content.title, icon: 'plugin' as const }]
  let select = (event: MouseEvent<HTMLButtonElement>) => void command('pane.overlay.select', { panel: event.currentTarget.dataset.tab })
  let minimize = () => void command('pane.overlay.bounds', { ...overlay.bounds, collapsed: true, compact: false })
  let close = () => void command('plugin.overlay.close')
  let keys = (event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
    let buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')], index = buttons.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next].focus()
    void command('pane.overlay.select', { panel: buttons[next].dataset.tab })
  }
  return <header className={css.dockHeader} onPointerDown={begin} onPointerMove={update} onPointerUp={end} onPointerCancel={end}>
    {!overlay.bounds.collapsed && <strong className={css.dockTitle}>{tabs.find(tab => tab.id === overlay.selectedTab)?.title || overlay.content.title}</strong>}
    <nav className={`${appCss.panelTabs} ${css.panelTabs}`} role="tablist" aria-label="Pane panels" onKeyDown={keys}>{tabs.map(tab => <button key={tab.id} role="tab" aria-label={tab.title} aria-selected={!overlay.bounds.collapsed && tab.id === overlay.selectedTab} aria-controls="pane-panel" title={tab.title} data-tab={tab.id} onClick={select}><PanelIcon icon={tab.icon} /></button>)}</nav>
    {!overlay.bounds.collapsed && <nav aria-label="Overlay controls"><button aria-label="Minimize page overlay" title="Minimize page overlay" onClick={minimize}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" /></svg></button>{overlay.selectedTab !== 'agent' && overlay.selectedTab !== 'viewport' && <button aria-label="Close overlay" onClick={close}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2 2 8 8m0-8-8 8" /></svg></button>}</nav>}
  </header>
}
let PanelIcon = ({ icon }: { icon: PaneOverlayTab['icon'] }) => icon === 'accounts' ? <img src={bmuxIcon} width="16" height="16" alt="" /> : <svg viewBox="0 0 20 20" aria-hidden="true">{icon === 'agent' ? <><rect x="3" y="6" width="14" height="11" rx="2" /><path d="M10 2v4M7 10v2m6-2v2M7 15h6" /></> : icon === 'viewport' ? <><rect x="2" y="3" width="16" height="14" rx="1" /><path d="M7 3v14M2 8h16" /></> : icon === 'search' ? <><circle cx="8" cy="8" r="5" /><path d="m12 12 5 5" /></> : icon === 'chart' ? <path d="M3 3v14h14M6 13V9m4 4V5m4 8V7" /> : <path d="M3 4h5V2h4v2h5v5h-2v4h2v4H3v-4h2V9H3Z" />}</svg>
let AgentPanel = () => {
  let { overlay, command } = useOverlay(), agent = overlay.agent
  if (!agent) return null
  let override = () => void command('pane.overlay.agent-override', { enabled: !agent.overridden })
  let info = () => void command('pane.overlay.agent-info')
  return <section aria-label="Agent control" className={css.body}>
    <h2>{agent.name}</h2><p role="status">{agent.locked ? 'Agent controlling · input locked' : agent.overridden ? 'Page input allowed for 5 minutes' : 'Agent idle'}</p>
    {agent.purpose && <p>{agent.purpose}</p>}<div className={css.controls}>{(agent.locked || agent.overridden) && <button onClick={override}>{agent.overridden ? 'Restore agent lock' : 'Allow page input (5 min)'}</button>}<button onClick={info}>Agent information</button></div>
  </section>
}
let ViewportPanel = () => {
  let { overlay, command } = useOverlay(), viewport = overlay.viewport
  let [width, setWidth] = useState(String(viewport?.width ?? '')), [height, setHeight] = useState(String(viewport?.height ?? '')), [scale, setScale] = useState(String((viewport?.zoom ?? 1) * 100))
  useEffect(() => { if (viewport) { setWidth(String(viewport.width)); setHeight(String(viewport.height)); setScale(String(Math.round(viewport.zoom * 10000) / 100)) } }, [viewport?.width, viewport?.height, viewport?.zoom])
  if (!viewport) return null
  let pan = () => void command('pane.overlay.pan', { enabled: !viewport.panning })
  let close = () => void command('pane.overlay.bounds', { ...overlay.bounds, collapsed: true, compact: false })
  let apply = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); let result = await command('pane.overlay.viewport', { width: Number(width), height: Number(height), zoom: Number(scale) / 100 }); if (result !== undefined) close() }
  let changeWidth = (event: ChangeEvent<HTMLInputElement>) => setWidth(event.target.value)
  let changeHeight = (event: ChangeEvent<HTMLInputElement>) => setHeight(event.target.value)
  let changeScale = (event: ChangeEvent<HTMLInputElement>) => setScale(event.target.value)
  let preset = (event: ChangeEvent<HTMLSelectElement>) => {
    if (event.target.value === 'custom') return
    let selected = event.target.value.startsWith('recent:') ? viewport.recent[Number(event.target.value.slice(7))] : undefined
    let [w,h,z] = selected ? [selected.width, selected.height, selected.zoom * 100] : event.target.value.split(':').map(Number); setWidth(String(w)); setHeight(String(h)); setScale(String(z ?? 100))
  }
  return <section aria-label="Locked viewport" className={css.body}><button aria-label="Pan viewport" title="Pan viewport" aria-pressed={viewport.panning} onClick={pan}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 13V6a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v6c0 4-3 7-7 7h-1c-2 0-3-1-4-2l-4-5a1.5 1.5 0 0 1 2-2l2 2" /></svg></button>
    <form aria-label="Viewport settings" onSubmit={apply} className={css.viewportForm}>
      <ViewportPresets viewport={viewport} change={preset} />
      <label>Width<input type="number" min="1" max="16384" required value={width} onChange={changeWidth} /></label>
      <label>Height<input type="number" min="1" max="16384" required value={height} onChange={changeHeight} /></label>
      <label>Scale (%)<input type="number" min="25" max="300" step="any" required value={scale} onChange={changeScale} /></label>
      <div className={css.controls}><button type="button" onClick={close}>Cancel</button><button type="submit">Apply</button></div>
    </form>
  </section>
}
let ViewportPresets = ({ viewport, change }: { viewport: NonNullable<PluginOverlayState['viewport']>; change: (event: ChangeEvent<HTMLSelectElement>) => void }) => <label>Viewport preset<select aria-label="Viewport preset" onChange={change} value="custom">
  <option value="custom">Custom</option>
  {viewport.recent.length > 0 && <optgroup label="Recently used">{viewport.recent.map((size, index) => <option key={index} value={`recent:${index}`}>{size.width} × {size.height} · {Math.round(size.zoom * 100)}%</option>)}</optgroup>}
  <option value="900:1260">Portrait · 900 × 1260</option><option value="1728:1117">MacBook Pro 16″ · 1728 × 1117</option><option value="2240:1260">iMac 24″ · 2240 × 1260</option><option value="1512:982">MacBook Pro 14″ · 1512 × 982</option><option value="402:874">iPhone 17 · 402 × 874</option><option value="440:956">iPhone 17 Pro Max · 440 × 956</option><option value="1440:900">Laptop · 1440 × 900</option><option value="1920:1080">Desktop · 1920 × 1080</option>
</select></label>
let CompactAction = ({ concise = false }: { concise?: boolean }) => {
  let { overlay, input, busy } = useOverlay(), summary = pluginOverlaySummary(overlay.content)
  let control = overlay.content.controls.find(control => control.kind === 'button' && ['pause', 'resume', 'start'].includes(control.id))
  let click = () => { if (control) void input(control.id) }
  return <><span role="status" className={css.compactAction} title={summary.action}>{concise ? summary.action.replace(/^Watching: (\d+)s remaining$/, 'Watch $1s').replace('Moving to next post', 'Next post').replace('Checking creator profile', 'Creator profile') : summary.action}</span>{!overlay.ended && control && <button aria-label={control.label} title={control.label} disabled={busy || control.disabled} onClick={click}><svg viewBox="0 0 12 12" aria-hidden="true">{control.id === 'pause' ? <path d="M4 2v8M8 2v8" /> : <path d="m4 2 5 4-5 4Z" />}</svg></button>}{concise && <NextPostButton />}</>
}
let NextPostButton = () => {
  let { overlay, input, busy } = useOverlay(), control = overlay.content.controls.find(control => control.id === 'next' && control.kind === 'button')
  let next = () => void input('next')
  return !overlay.ended && control ? <button aria-label="Show next post" title="Show next video (override AI)" disabled={busy || control.disabled} onClick={next}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2 2 6 4-6 4Z M10 2v8" /></svg></button> : null
}
let DecisionBody = () => {
  let { overlay, setting } = useOverlay(), [popup, setPopup] = useState<'settings' | 'usage'>()
  let post = overlay.content.nodes[0], decision = overlay.content.decision!
  let awaitingStart = overlay.content.controls.some(control => control.id === 'continue' && /^Start/.test(control.label))
  let popupRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (setting) setPopup('settings') }, [setting])
  useEffect(() => {
    if (!popup) return
    let frame = requestAnimationFrame(() => {
      let field = setting && [...popupRef.current!.querySelectorAll<HTMLElement>('[data-overlay-setting]')].find(field => field.dataset.overlaySetting === setting.id)
      ;(field?.querySelector<HTMLElement>('input,select,textarea') || popupRef.current?.querySelector<HTMLElement>('button'))?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [popup, setting])
  let settings = () => setPopup(current => current === 'settings' ? undefined : 'settings')
  let usage = () => setPopup(current => current === 'usage' ? undefined : 'usage')
  let close = () => setPopup(undefined)
  let keys = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }
  if (awaitingStart) return <div className={css.body}><h2>Ready to browse</h2><p role="status">Choose Start browsing to review each action, or Start with auto continue.</p><p>{overlay.content.subtitle}</p></div>
  return <>
    <div className={css.body}>
      <p className={css.status}>{overlay.content.status}</p><section className={css.postExcerpt}><h2>{post?.title || 'Post'}</h2><p title={post?.lines.join(' ')}>{post?.lines.join(' ').slice(0, 240) || 'Waiting for a post'}</p></section>
      <div className={css.decisionRoot}>{decision.loading && <span className={css.spinner} role="status" aria-label="AI is deciding" />}{decision.loading ? 'AI is deciding' : 'Possible outcomes'}</div>
      <DecisionTree />
      <div className={css.actionLine}><CompactAction /><NextPostButton /></div>
    </div>
    {overlay.content.nodes.filter(node => node.title === 'Interactions').map(node => <div key={node.title} className={css.interactionSummary}>{node.lines.map((line,index) => <p key={index}>{line}</p>)}</div>)}
    <div className={css.controls}><button aria-expanded={popup === 'settings'} onClick={settings}>Settings</button><button aria-expanded={popup === 'usage'} onClick={usage}>Usage</button></div>
    {popup && <div className={css.popup} role="dialog" aria-label={popup === 'settings' ? 'Overlay settings' : 'Session usage'} ref={popupRef} onKeyDown={keys}>
      <div className={css.popupHeading}><h2>{popup === 'settings' ? 'Settings' : 'Usage'}</h2><button onClick={close} aria-label="Close popup">Close</button></div>
      {popup === 'settings' ? <>{overlay.content.controls.filter(control => control.kind !== 'button').map(control => <OverlayField key={control.id} control={control} />)}<OverlayButtons failed={false} /></> : <><p>{overlay.content.metrics || 'No usage recorded yet.'}</p>{overlay.content.details.map(detail => <details key={detail.title}><summary>{detail.title}</summary><pre>{detail.text}</pre></details>)}{overlay.content.copies?.map(copy => <CopyPayload key={copy.id} id={copy.id} label={copy.label} />)}</>}
    </div>}
  </>
}
let DecisionTree = () => {
  let { overlay } = useOverlay(), decision = overlay.content.decision!
  return <div className={css.decisionTree} role="tree" aria-label="Possible outcomes" aria-busy={decision.loading}>
        {decision.options.filter(option => option.id === 'skip').map(option => <DecisionBranch key={option.id} option={option} loading={decision.loading} />)}
        <div role="treeitem" aria-expanded="true" className={css.watchBranch}><div className={css.watchLabel} data-active={!decision.loading && decision.options.some(option => ['watch','linger','finish'].includes(option.id) && option.active)}>Watch</div>
          <div role="group" className={css.watchOptions}>{decision.options.filter(option => ['watch','linger','finish'].includes(option.id)).map(option => <DecisionBranch key={option.id} option={option} loading={decision.loading} />)}</div>
          <div role="group" aria-label="After watching" className={css.watchOptions}>{decision.options.filter(option => !['skip','watch','linger','finish'].includes(option.id)).map(option => <DecisionBranch key={option.id} option={option} loading={decision.loading} />)}</div>
        </div>
      </div>
}
let DecisionBranch = ({ option, loading }: { option: NonNullable<PluginOverlayState['content']['decision']>['options'][number]; loading: boolean }) => <div role="treeitem" aria-selected={!loading && option.active} className={css.decisionBranch} data-active={!loading && option.active}><span>{option.label}</span><span>{loading ? '…' : option.probability === undefined ? option.active ? 'Active' : '—' : Math.round(option.probability * 100) + '%'}</span></div>
let CopyPayload = ({ id, label }: { id: string; label: string }) => {
  let { command } = useOverlay(), [copied, setCopied] = useState(false)
  let copy = async () => { let result = await command('plugin.overlay.copy', { copy: id }) as { copied?: boolean }; setCopied(!!result?.copied) }
  return <button onClick={copy}>{copied ? 'Copied' : label}</button>
}
let CompactOverlay = () => <div className={css.compactBody} aria-label="Compact session status"><CompactAction /><NextPostButton /></div>
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
