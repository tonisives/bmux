import type { SiteSecurity } from '../shared/site-security'
import type { MediaDevice, PublicState } from '../shared/types'
import { connectionLabels, initialSecurity } from '../shared/site-security'
import css from './ConnectionIndicator.module.css'

export let mediaControls = { video: 'camera-access', audio: 'microphone-access' } as const
export type MediaControl = (typeof mediaControls)[MediaDevice]

export let MediaAccessButtons = ({ state, tabId, open }: { state: PublicState; tabId: string; open: (control: MediaControl) => void }) => {
  let site = state.browserTools?.tabs[tabId]
  if (!site?.origin) return null
  let pending = state.permissions.find(request => request.paneId === tabId && request.origin === site.origin && request.mediaDevices)?.mediaDevices
  return (['video', 'audio'] as const).map(device => {
    let allowed = site.mediaPermissions?.[device]
    if (allowed === undefined && !pending?.includes(device)) return null
    let label = device === 'video' ? 'Camera access' : 'Microphone access'
    let status = pending?.includes(device) ? 'Review request' : allowed ? 'Allowed' : 'Blocked'
    let show = () => open(mediaControls[device])
    return <button key={device} type="button" className={css.indicator} data-media-status={status} aria-haspopup="dialog" aria-label={`${label}: ${status}`} title={`${label}: ${status}`} onClick={show}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {device === 'video' ? <><rect x="1.75" y="4" width="8.5" height="8" rx="1.5" /><path d="m10.25 7 4-2v6l-4-2" /></> : <><rect x="6" y="1.5" width="4" height="8" rx="2" /><path d="M4 7.5V8a4 4 0 0 0 8 0v-.5M8 12v2.5" /></>}
        {status === 'Blocked' && <path d="m2 14 12-12" />}
      </svg>
    </button>
  })
}

export let ConnectionIndicator = ({ security, url, open }: { security?: SiteSecurity; url: string; open: () => void }) => {
  let status = security?.url === url ? security.status : initialSecurity(url).status
  let label = connectionLabels[status]
  return <button type="button" className={css.indicator} data-connection={status} aria-label={`Site information: ${label}`} title={label} onClick={open}>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 5h2m4 0h6M2 11h6m4 0h2" /><circle cx="6" cy="5" r="2" /><circle cx="10" cy="11" r="2" />
    </svg>
  </button>
}
