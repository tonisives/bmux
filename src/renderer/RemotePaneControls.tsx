import { useEffect, useRef, useState } from 'react'
import type { Bridge } from '../shared/types'
import type { RemoteView } from '../shared/remote'
import css from './RemotePaneControls.module.css'

export let RemotePaneControls = ({ remote, paneId, focused, run, onError }: { remote: RemoteView; paneId: string; focused: boolean; run: (method: string, args?: Record<string, unknown>) => Promise<unknown>; onError: (error: string) => void }) => {
  let [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false)
  let yes = useRef<HTMLButtonElement>(null), closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!focused) return
    localStorage.setItem('remote-session-last-active', `${remote.hostId}:${remote.sessionId}`)
    if (remote.pane) localStorage.setItem('remote-session-last-pane', remote.pane)
  }, [focused, remote.hostId, remote.sessionId, remote.pane])
  useEffect(() => { if (confirming) yes.current?.focus() }, [confirming])
  let cancel = () => { setConfirming(false); requestAnimationFrame(() => closeButton.current?.focus()) }
  let close = async () => {
    if (busy) return
    setBusy(true)
    try { await bridge.closeRemoteSession(remote.hostId, remote.sessionId); setConfirming(false) }
    catch (error) { onError((error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')); cancel() }
    finally { setBusy(false) }
  }
  let action = (action: string) => { void run('remote.action', { pane: paneId, action }) }
  let connection = remote.preview ? 'Preview' : remote.error || (!remote.connected ? 'Connecting' : remote.controlling ? 'Controlling' : 'Watching')
  let controlLabel = remote.controlling ? 'Release control' : remote.occupied ? 'Take over' : 'Take control'
  let watch = () => action('watch')
  let control = () => action(remote.controlling ? 'release' : 'acquire')
  let ask = () => setConfirming(true)
  let disconnect = () => action('disconnect')
  let confirmKeys = (event: React.KeyboardEvent<HTMLDivElement>) => { event.stopPropagation(); if (event.key === 'y') { event.preventDefault(); void close() } else if (event.key === 'n' || event.key === 'Escape') { event.preventDefault(); cancel() } }
  return <div className={css.controls} role="group" aria-label="Remote session controls">
    <span className={css.connection} role="status" title={remote.error || `${connection} · ${remote.service}`} aria-label={connection} data-connected={remote.connected} data-error={!!remote.error}><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4" /></svg></span>
    {remote.preview && <button type="button" onClick={watch} aria-label="View live" title="View live"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6Z" /></svg></button>}
    {remote.canControl && <button type="button" onClick={control} disabled={!remote.connected} aria-label={controlLabel} title={controlLabel} aria-pressed={remote.controlling}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 2 12 9-6 1-3 6Z" />{remote.controlling && <path d="m11 15 2 2 4-5" />}</svg></button>}
    {remote.canControl && (confirming ? <div className={css.confirmation} role="alertdialog" aria-label={`Close remote session ${remote.name}?`} onKeyDown={confirmKeys}><span>Close "{remote.name}"?</span><button type="button" ref={yes} disabled={busy} onClick={close}>yes</button><button type="button" disabled={busy} onClick={cancel}>no</button></div> : <button type="button" ref={closeButton} onClick={ask} aria-label="Close session" title="Close remote session"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" /><path d="m7 7 6 6m0-6-6 6" /></svg></button>)}
    <button type="button" onClick={disconnect} aria-label="Disconnect" title="Disconnect"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M9 3H3v14h6m-1-7h10m-4-4 4 4-4 4" /></svg></button>
  </div>
}
let bridge = (window as unknown as { bmux: Bridge }).bmux
