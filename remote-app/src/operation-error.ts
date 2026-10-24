let messages: Record<string, string> = {
  STALE_REVISION: 'This session or profile changed. Refresh it and try again.',
  TARGET_UNAVAILABLE: 'The requested page is no longer available.',
  PROFILE_UNAVAILABLE: 'This profile is no longer available.',
  SESSION_NAME_UNAVAILABLE: 'Choose another session name.',
  WATCH_ONLY: 'This host allows watching only.',
  PROXY_LOCKED: 'This profile’s connection is managed by its host.',
  PROXY_REQUIRED: 'Configure a proxy before testing it.',
  PROXY_CREDENTIALS_REQUIRED: 'Set the proxy username and password.',
  INCLUDED_PANE_LIMIT: 'The included browser has one page.',
  ATTENTION_CHANGED: 'The help request changed. Refresh before resuming.',
  ATTENTION_ATTEMPT_LIMIT: 'This request needs attention on its host.',
  LIVE_VIEW_REQUIRED: 'Open the page before taking this action.',
  MANAGEMENT_PERSIST_FAILED: 'The host could not save the change.',
  INVALID_REQUEST: 'This action could not be applied. Refresh and try again.',
}
export let operationMessage = (code: unknown, fallback: unknown) => typeof code === 'string' && messages[code] || (typeof fallback === 'string' ? fallback : 'The action could not be completed.')
