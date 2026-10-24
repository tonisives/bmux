export let PREVIEW_INTERVAL_MS = 15_000

type Refresh = { dirty: boolean; running: boolean; attemptedAt?: number; timer?: ReturnType<typeof setTimeout> }

export let createPreviewRefresh = (options: {
  exists: (pane: string) => boolean
  capturedAt: (pane: string) => number | undefined
  capture: (pane: string) => Promise<void> | undefined
}) => {
  let panes = new Map<string, Refresh>(), closed = false
  let remove = (pane: string) => { clearTimeout(panes.get(pane)?.timer); panes.delete(pane) }
  let schedule = (pane: string, refresh: Refresh) => {
    if (closed || !refresh.dirty || refresh.running || refresh.timer || panes.get(pane) !== refresh) return
    if (!options.exists(pane)) { remove(pane); return }
    let previous = Math.max(options.capturedAt(pane) ?? -Infinity, refresh.attemptedAt ?? -Infinity)
    refresh.timer = setTimeout(() => {
      refresh.timer = undefined
      if (!options.exists(pane)) { remove(pane); return }
      let before = options.capturedAt(pane), pending = options.capture(pane)
      if (!pending) { schedule(pane, refresh); return }
      refresh.attemptedAt = Date.now(); refresh.dirty = false; refresh.running = true
      void pending.catch(() => undefined).finally(() => {
        refresh.running = false
        if (options.capturedAt(pane) === before) refresh.dirty = true
        schedule(pane, refresh)
      })
    }, Math.max(250, previous + PREVIEW_INTERVAL_MS - Date.now()))
    refresh.timer.unref?.()
  }
  return {
    request: (pane: string) => {
      if (closed) return
      let refresh = panes.get(pane) ?? { dirty: true, running: false }
      refresh.dirty = true; panes.set(pane, refresh); schedule(pane, refresh)
    },
    remove,
    close: () => { closed = true; for (let pane of panes.keys()) remove(pane) },
  }
}
