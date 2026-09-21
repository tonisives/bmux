import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import type { Bridge, FloatingPane as Placement, PublicState } from '../shared/types'
import { clampFloat } from '../shared/floating'
import css from './FloatingPane.module.css'
import { CloseButton } from './CloseButton'

export let FloatingPane = () => {
  let [state, setState] = useState<PublicState | null>(null)
  let [error, setError] = useState('')
  let [address, setAddress] = useState('')
  let input = useRef<HTMLInputElement>(null)
  let editing = useRef(false)
  let windowState = state?.model.sessions.flatMap(session => session.windows).find(window => window.panes.some(pane => pane.id === paneId))
  let pane = windowState?.panes.find(pane => pane.id === paneId)
  let tab = pane?.tabs.find(tab => tab.id === pane.activeTabId)
  let placement = windowState?.floating?.find(item => item.paneId === paneId)
  let run = useCallback(async (method: string, args: Record<string, unknown> = {}) => {
    try { return await bridge.command({ method, args: { client: state?.clientId, pane: paneId, ...args } }) }
    catch (error) { setError(String(error)); return undefined }
  }, [state?.clientId])
  let drag = useFloatingDrag(placement, state, run)
  useEffect(() => {
    let unsubscribe = bridge.subscribe(setState)
    void bridge.state().then(setState).catch(error => setError(String(error)))
    let controls = bridge.controls(control => { if (control === 'address') { editing.current = true; input.current?.focus(); input.current?.select() } })
    return () => { unsubscribe(); controls() }
  }, [])
  useEffect(() => { if (!editing.current) setAddress(tab?.url === 'about:blank' ? '' : tab?.url ?? '') }, [tab?.url, tab?.id])
  useEffect(() => {
    if (tab?.url === 'about:blank' && state?.focusedClientId === state?.clientId && state?.model.clients.find(client => client.id === state.clientId)?.paneId === paneId) input.current?.focus()
  }, [tab?.id])
  let focus = () => {
    editing.current = true
    void run('select-pane', { focus: false }).then(() => run('focus-ui'))
  }
  let blur = () => { editing.current = false }
  let change = (event: ChangeEvent<HTMLInputElement>) => setAddress(event.target.value)
  let submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!tab || !address.trim()) return
    setError(''); editing.current = false
    await run('select-pane', { focus: false })
    await run('navigate', { tab: tab.id, url: address.trim() })
    await run('focus-page')
  }
  let keys = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Escape') { editing.current = false; setAddress(tab?.url === 'about:blank' ? '' : tab?.url ?? ''); void run('focus-page') } }
  let menu = (event: MouseEvent) => { event.preventDefault(); void run('pane.menu') }
  let close = () => { void run('pane.close') }
  let back = () => { if (tab) void run('back', { tab: tab.id }) }
  let forward = () => { if (tab) void run('forward', { tab: tab.id }) }
  let reload = () => { if (tab) void run('reload', { tab: tab.id }) }
  let focusPage = () => { void run('select-pane') }
  let navigation = tab && state?.navigation[tab.id]
  let client = state?.model.clients.find(client => client.id === state.clientId)
  return <section className={css.frame} data-floating-pane={paneId} data-focused={client?.paneId === paneId}>
    <form className={css.address} onSubmit={submit} onContextMenu={menu}>
      <button className={css.knob} type="button" onPointerDown={drag} data-drag-handle aria-label="Move floating pane" />
      <button type="button" onClick={back} aria-label="Back" disabled={!navigation || navigation.activeIndex <= 0}>←</button>
      <button type="button" onClick={forward} aria-label="Forward" disabled={!navigation || navigation.activeIndex >= navigation.entries.length - 1}>→</button>
      <button type="button" onClick={reload} aria-label="Reload">↻</button>
      <input ref={input} value={address} onChange={change} onFocus={focus} onBlur={blur} onKeyDown={keys} aria-label="Address" placeholder="Enter URL" spellCheck={false} />
      <div className={css.dragSpace} onPointerDown={drag} data-drag-space aria-hidden="true" />
      <div className={css.dragAbove} onPointerDown={drag} data-drag-above aria-hidden="true" />
      <CloseButton label="Close floating pane" onClick={close} />
    </form>
    <div className={css.content} onMouseDown={focusPage} onContextMenu={menu}>
      {error || (tab && state?.crashes[tab.id]) ? <p role="alert">{error || state?.crashes[tab!.id]}<button onClick={reload}>Reload</button></p> : tab && state?.snapshots[tab.id] ? <img src={state.snapshots[tab.id].image} alt="Page preview" /> : <span>{tab?.url === 'about:blank' ? 'Enter a URL above' : 'Loading…'}</span>}
    </div>
    {edges.map(edge => <div key={edge} className={css.edge} data-edge={edge} onPointerDown={drag} role="separator" aria-label={`Resize floating pane ${edge}`} />)}
  </section>
}

let bridge = (window as unknown as { bmux: Bridge }).bmux
let paneId = location.hash.slice('#float='.length)
let edges = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']

let useFloatingDrag = (placement: Placement | undefined, state: PublicState | null, run: (method: string, args?: Record<string, unknown>) => Promise<unknown>) => {
  let cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])
  useEffect(() => { if (!placement) cleanup.current?.() }, [placement])
  return (event: PointerEvent<HTMLElement>) => {
    let target = event.target as HTMLElement
    if (event.button !== 0 || !placement || !state || (target.closest('button,input') && !target.closest('[data-drag-handle]'))) return
    cleanup.current?.()
    event.preventDefault()
    let client = state.model.clients.find(client => client.id === state.clientId)!
    let element = event.currentTarget
    let edge = element.dataset.edge ?? ''
    let initial = clampFloat(placement, client.width, client.height - 28)
    let startX = event.screenX, startY = event.screenY
    let rect = initial
    let frame = 0
    let pointer = event.pointerId
    let ended = false
    element.setPointerCapture(pointer)
    void run('select-pane', { pane: paneId, focus: false })
    let publish = (commit: boolean) => run('float.bounds', { ...rect, pane: paneId, commit })
    let move = (event: globalThis.PointerEvent) => {
      let dx = event.screenX - startX, dy = event.screenY - startY
      let right = initial.x + initial.width, bottom = initial.y + initial.height
      let x = edge ? edge.includes('w') ? Math.max(0, Math.min(right - Math.min(320, client.width), initial.x + dx)) : initial.x : initial.x + dx
      let y = edge ? edge.includes('n') ? Math.max(0, Math.min(bottom - Math.min(200, client.height - 28), initial.y + dy)) : initial.y : initial.y + dy
      let width = edge.includes('w') ? right - x : edge.includes('e') ? initial.width + dx : initial.width
      let height = edge.includes('n') ? bottom - y : edge.includes('s') ? initial.height + dy : initial.height
      rect = clampFloat({ ...initial, x, y, width, height }, client.width, client.height - 28)
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; void publish(false) })
    }
    let end = () => {
      if (ended) return
      ended = true; cancelAnimationFrame(frame)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', end)
      element.removeEventListener('pointercancel', end)
      element.removeEventListener('lostpointercapture', end)
      window.removeEventListener('blur', end)
      if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer)
      cleanup.current = null
      void publish(true)
    }
    cleanup.current = end
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', end)
    element.addEventListener('pointercancel', end)
    element.addEventListener('lostpointercapture', end)
    window.addEventListener('blur', end)
  }
}
