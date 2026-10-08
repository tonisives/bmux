import type { SiteSecurity } from '../shared/site-security'
import { connectionLabels, initialSecurity } from '../shared/site-security'
import css from './ConnectionIndicator.module.css'

export let ConnectionIndicator = ({ security, url, open }: { security?: SiteSecurity; url: string; open: () => void }) => {
  let status = security?.url === url ? security.status : initialSecurity(url).status
  let label = connectionLabels[status]
  return <button type="button" className={css.indicator} data-connection={status} aria-label={`Site information: ${label}`} title={label} onClick={open}>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 5h2m4 0h6M2 11h6m4 0h2" /><circle cx="6" cy="5" r="2" /><circle cx="10" cy="11" r="2" />
    </svg>
  </button>
}
