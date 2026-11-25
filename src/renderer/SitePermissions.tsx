import { useId, useState } from 'react'
import { flushSync } from 'react-dom'
import type { MediaDevice } from '../shared/types'
import { MediaDeviceIcon } from './ConnectionIndicator'
import { MediaDeviceTest, mediaSystemAccessMessage } from './MediaDeviceTest'
import css from './SitePermissions.module.css'

type SitePermissionsProps = {
  origin: string
  decisions?: Partial<Record<MediaDevice, boolean>>
  prepare: (device: MediaDevice) => Promise<boolean>
  decide: (device: MediaDevice, allow: boolean) => Promise<{ blocked?: MediaDevice[] }>
  reset: () => void
}

export let SitePermissions = ({ origin, decisions, prepare, decide, reset }: SitePermissionsProps) => {
  let [expanded, setExpanded] = useState<MediaDevice>()
  return <section className={css.permissions} aria-label={`Permissions for ${origin}`}>
    <p>{origin}</p>
    {(['video', 'audio'] as const).map(device => <PermissionRow key={device} device={device} decision={decisions?.[device]} expanded={expanded === device} toggle={() => setExpanded(expanded === device ? undefined : device)} prepare={prepare} decide={decide} />)}
    {Object.values(decisions ?? {}).some(value => value !== undefined) && <button className={css.reset} type="button" onClick={reset}>Reset camera and mic permissions and reload</button>}
  </section>
}

type PermissionRowProps = Pick<SitePermissionsProps, 'prepare' | 'decide'> & { device: MediaDevice; decision?: boolean; expanded: boolean; toggle: () => void }
let PermissionRow = ({ device, decision, expanded, toggle, prepare, decide }: PermissionRowProps) => {
  let id = useId()
  let [busy, setBusy] = useState(false), [error, setError] = useState(''), [startTesting, setStartTesting] = useState(true)
  let label = device === 'video' ? 'Camera' : 'Microphone'
  let status = decision === undefined ? 'Ask' : decision ? 'Allowed' : 'Blocked'
  let expand = () => {
    if (!expanded) { setStartTesting(true); setError('') }
    toggle()
  }
  let apply = async (allow: boolean) => {
    setError('')
    // Release the test stream before a pending capture request can resume.
    flushSync(() => { setStartTesting(false); setBusy(true) })
    try {
      let result = await decide(device, allow)
      if (result.blocked?.length) setError(mediaSystemAccessMessage(result.blocked))
    } catch (failure) {
      setError((failure instanceof Error ? failure.message : String(failure)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''))
    } finally { setBusy(false) }
  }
  let allow = () => { void apply(true) }, block = () => { void apply(false) }
  return <div className={css.permission}>
    <button type="button" className={css.row} onClick={expand} aria-expanded={expanded} aria-controls={id} disabled={busy}>
      <MediaDeviceIcon device={device} blocked={decision === false} />
      {label}<span className={css.status}>{status}</span>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
    </button>
    <div id={id} hidden={!expanded} className={css.details}>
      {expanded && !busy && <MediaDeviceTest devices={[device]} prepare={prepare} startTesting={startTesting} />}
      {expanded && error && <p className={css.error} role="alert">{error}</p>}
      <div className={css.actions}>
        <button type="button" onClick={block} disabled={busy || decision === false}>Block</button>
        <button type="button" onClick={allow} disabled={busy || decision === true}>Allow</button>
      </div>
    </div>
  </div>
}
