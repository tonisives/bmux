import type { NavigationProxyHint } from '../shared/types'
import css from './NavigationFailure.module.css'

export let NavigationFailure = ({ error, hint, reload }: { error: string; hint?: NavigationProxyHint; reload: () => void }) => <div className={css.failure} role="alert" aria-label="Page failed to load">
  <p>{error}</p>
  {hint && <div className={css.hint} role="note" aria-label="Proxy connection help">
    <p>{hint.local ? `${hint.hostname} points to a local or private address. This pane uses a proxy, which may not be able to reach it.` : `This pane uses a proxy. If ${hint.hostname} is a local app or a hostname mapped to this computer, the proxy may not be able to reach it.`}</p>
    <p>{hint.required ? 'This browser host requires the proxy. The app must be reachable from that proxy.' : 'Open this URL in a new pane with “Use for new panes” turned off in Proxy settings.'}</p>
  </div>}
  <button type="button" onClick={reload}>Reload</button>
</div>
