import type { State } from './client'

type ViewerMessage = ({ type: 'state' } & State) | { type: 'error'; error: string }
type ViewerEvents = { state: (state: State) => void; error: (error: string) => void; ready: () => void; refresh: () => void }

export let receiveViewerMessage = (message: ViewerMessage, events: ViewerEvents) => {
  if (message.type === 'state') { events.state(message); events.ready() }
  else if (message.type === 'error') {
    // A desktop takeover can invalidate the lease while this viewer is hidden.
    // Ask for current ownership rather than leaving stale controls on screen.
    if (message.error === 'CONTROL_EXPIRED' || message.error === 'CONTROL_HELD') events.refresh()
    events.error(message.error)
  }
}

export let observeViewerFocus = (refresh: () => void, target: EventTarget, visibility: EventTarget & { readonly hidden: boolean }) => {
  let visible = () => { if (!visibility.hidden) refresh() }
  target.addEventListener('focus', visible)
  visibility.addEventListener('visibilitychange', visible)
  return () => {
    target.removeEventListener('focus', visible)
    visibility.removeEventListener('visibilitychange', visible)
  }
}
