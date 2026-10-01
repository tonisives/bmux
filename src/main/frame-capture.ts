type Contents<Frame> = { id: number; capturePage: () => Promise<Frame>; getBackgroundThrottling: () => boolean; setBackgroundThrottling: (enabled: boolean) => void; isDestroyed: () => boolean }
type Capture = { listeners: Set<(data: string) => void>; throttled: boolean; timer?: ReturnType<typeof setInterval>; pending: boolean }

// Share one bounded capture per pane. Avoid native subscription teardown while
// a viewer reloads or its transport window is destroyed.
export let createFrameCapture = <Frame>(encode: (frame: Frame) => string) => {
  let captures = new Map<number, Capture>()
  return (contents: Contents<Frame>, listener: (data: string) => void) => {
    let capture = captures.get(contents.id)
    if (!capture) {
      capture = { listeners: new Set(), throttled: contents.getBackgroundThrottling(), pending: false }
      captures.set(contents.id, capture)
      contents.setBackgroundThrottling(false)
      let current = capture
      let poll = () => {
        if (current.pending || contents.isDestroyed() || captures.get(contents.id) !== current) return
        current.pending = true
        void Promise.resolve().then(() => {
          if (contents.isDestroyed() || captures.get(contents.id) !== current) return
          return contents.capturePage()
        }).then(frame => {
          if (frame === undefined || contents.isDestroyed() || captures.get(contents.id) !== current) return
          let data = encode(frame)
          for (let notify of current.listeners) notify(data)
        }).catch(() => undefined).finally(() => { current.pending = false })
      }
      current.timer = setInterval(poll, 100)
      current.listeners.add(listener)
      poll()
    } else capture.listeners.add(listener)
    let current = capture
    return () => {
      current.listeners.delete(listener)
      if (current.listeners.size || captures.get(contents.id) !== current) return
      clearInterval(current.timer)
      captures.delete(contents.id)
      if (!contents.isDestroyed()) contents.setBackgroundThrottling(current.throttled)
    }
  }
}
