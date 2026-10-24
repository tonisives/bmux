type Page<Frame> = { capturePage: (rect?: undefined, options?: { stayHidden: boolean }) => Promise<Frame> }
type Contents<Frame> = Page<Frame> & { id: number; getBackgroundThrottling: () => boolean; setBackgroundThrottling: (enabled: boolean) => void; isDestroyed: () => boolean }
type Capture = { listeners: Set<(data: string) => void>; throttled: boolean; timer?: ReturnType<typeof setInterval>; pending: boolean }

let pendingFrames = new WeakMap<object, Promise<unknown>>()
export let capturePageFrame = <Frame>(contents: Page<Frame>): Promise<Frame> => {
  let pending = pendingFrames.get(contents)
  if (pending) return pending as Promise<Frame>
  let frame = Promise.resolve().then(() => contents.capturePage(undefined, { stayHidden: true })).finally(() => {
    if (pendingFrames.get(contents) === frame) pendingFrames.delete(contents)
  })
  pendingFrames.set(contents, frame)
  return frame
}

// Share one bounded capture per pane. Avoid native subscription teardown while
// a viewer reloads or its transport window is destroyed.
export let createFrameCapture = <Frame>(encode: (frame: Frame) => string | undefined) => {
  let captures = new Map<number, Capture>()
  return (contents: Contents<Frame>, listener: (data: string) => void) => {
    let capture = captures.get(contents.id)
    if (!capture) {
      capture = { listeners: new Set(), throttled: contents.getBackgroundThrottling(), pending: false }
      captures.set(contents.id, capture)
      contents.setBackgroundThrottling(false)
      let current = capture, previous = pendingFrames.get(contents)
      let poll = () => {
        if (current.pending || contents.isDestroyed() || captures.get(contents.id) !== current) return
        current.pending = true
        void Promise.resolve(previous).catch(() => undefined).then(() => {
          if (contents.isDestroyed() || captures.get(contents.id) !== current) return
          return capturePageFrame(contents)
        }).then(frame => {
          if (frame === undefined || contents.isDestroyed() || captures.get(contents.id) !== current) return
          let data = encode(frame)
          if (data === undefined) return
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
