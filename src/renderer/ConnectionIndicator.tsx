import type { SiteSecurity } from '../shared/site-security'
import { connectionLabels, initialSecurity } from '../shared/site-security'
import css from './ConnectionIndicator.module.css'

export let ConnectionIndicator = ({ security, url, open }: { security?: SiteSecurity; url: string; open: () => void }) => {
  let status = security?.url === url ? security.status : initialSecurity(url).status
  let label = connectionLabels[status]
  return <button type="button" className={css.indicator} data-connection={status} aria-label={`Site information: ${label}`} title={label} onClick={open}>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {status === 'secure' ? <><rect x="3.5" y="7" width="9" height="6.5" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></> : status === 'local' ? <><rect x="2" y="3" width="12" height="9" rx="1" /><path d="M5 14h6M8 12v2" /></> : ['http', 'certificate-error', 'mixed', 'insecure'].includes(status) ? <><path d="m8 2 6 11H2Z M8 6v3M8 11h.01" /></> : <><circle cx="8" cy="8" r="5.5" /><path d="M8 7v4M8 5h.01" /></>}
    </svg>
  </button>
}
