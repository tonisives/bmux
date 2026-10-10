import type { InternalWindow } from './types'

export let windowVisitTime = (window: Pick<InternalWindow, 'lastVisitedAt' | 'panes'>) => window.lastVisitedAt ?? (Math.max(0, ...window.panes.map(pane => pane.lastActivityAt ?? 0)) || undefined)

export let activityLabel = (when: number | undefined, now = Date.now()) => {
  if (!when) return ''
  let age = Math.max(0, now - when) / 1000
  if (age < 60) return 'just now'
  for (let [seconds, suffix] of [[604800, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm']] as const) {
    if (age >= seconds) return `${Math.floor(age / seconds)}${suffix} ago`
  }
  return 'just now'
}
