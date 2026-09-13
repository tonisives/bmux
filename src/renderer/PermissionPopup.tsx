import { useEffect, useState } from 'react'
import type { Bridge, Permission } from '../shared/types'
import css from './PermissionPopup.module.css'

export let PermissionPopup = () => {
  let [permissions, setPermissions] = useState<Permission[]>([])
  useEffect(() => bridge.subscribe(state => setPermissions(state.permissions)), [])
  let request = permissions[0]
  return request ? <PermissionRequest key={request.id} request={request} permissions={permissions} /> : null
}

let bridge = (window as unknown as { bmux: Bridge }).bmux

let PermissionRequest = ({ request, permissions }: { request: Permission; permissions: Permission[] }) => {
  let [busy, setBusy] = useState(false), [error, setError] = useState('')
  let command = async (method: string, args: Record<string, unknown>) => {
    setBusy(true); setError('')
    try { await bridge.command({ method, args }) }
    catch { setError('Could not save your choice. Try again.') }
    finally { setBusy(false) }
  }
  let close = () => { void command('permission.dismiss', { ids: permissions.map(permission => permission.id) }) }
  let deny = () => { void command('permission.respond', { id: request.id, allow: false }) }
  let allow = () => { void command('permission.respond', { id: request.id, allow: true }) }
  return <section className={css.popup} role="dialog" aria-label="Permissions" aria-modal="false">
    <header><strong>Site permission</strong><span>{permissions.length > 1 ? `${permissions.length} pending` : ''}</span><button onClick={close} disabled={busy} aria-label="Close">×</button></header>
    <div className={css.content}>
      <p className={css.origin} title={request.origin}>{request.origin}</p>
      <p>Allow <strong>{request.permission}</strong>?</p>
      {error && <p role="alert">{error}</p>}
    </div>
    <footer><button onClick={deny} disabled={busy}>Deny</button><button onClick={allow} disabled={busy}>Allow</button></footer>
  </section>
}
