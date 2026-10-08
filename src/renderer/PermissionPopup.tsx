import { useEffect, useState } from 'react'
import type { Bridge, Permission, PublicState } from '../shared/types'
import css from './PermissionPopup.module.css'
import { CloseButton } from './CloseButton'
import { permissionPaneLabel } from '../shared/permission-source'

export let PermissionPopup = () => {
  let [state, setState] = useState<PublicState | null>(null)
  useEffect(() => bridge.subscribe(setState), [])
  let request = state?.permissions[0]
  return request && state ? <PermissionRequest key={request.id} request={request} state={state} /> : null
}

let bridge = (window as unknown as { bmux: Bridge }).bmux

let PermissionRequest = ({ request, state }: { request: Permission; state: PublicState }) => {
  let permissions = state.permissions, paneLabel = permissionPaneLabel(state.model, request.paneId)
  let [busy, setBusy] = useState(false), [error, setError] = useState('')
  let command = async (method: string, args: Record<string, unknown>, failure = 'Could not save your choice. Try again.') => {
    setBusy(true); setError('')
    try { await bridge.command({ method, args }) }
    catch { setError(failure) }
    finally { setBusy(false) }
  }
  let close = () => { void command('permission.dismiss', { ids: permissions.map(permission => permission.id) }) }
  let visit = () => { void command('permission.visit', { id: request.id, pane: request.paneId }, 'Could not open the requesting pane. Try again.') }
  let deny = () => { void command('permission.respond', { id: request.id, allow: false }) }
  let allow = () => { void command('permission.respond', { id: request.id, allow: true }) }
  return <section className={css.popup} role="dialog" aria-label="Permissions" aria-modal="false">
    <header><strong>Site permission</strong><span>{permissions.length > 1 ? `${permissions.length} pending` : ''}</span><CloseButton label="Close" onClick={close} disabled={busy} /></header>
    <div className={css.content}>
      <p className={css.origin} title={request.origin}>{request.origin}</p>
      <p>Allow <strong>{request.permission}</strong>?</p>
      {error && <p role="alert">{error}</p>}
    </div>
    <footer><button className={css.visit} onClick={visit} title={paneLabel} disabled={busy || !paneLabel}>Go to pane</button><button onClick={deny} disabled={busy}>Deny</button><button onClick={allow} disabled={busy}>Allow</button></footer>
  </section>
}
