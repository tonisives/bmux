// Agent observations can arrive from several panes between UI frames. Keep
// their status current without serializing the whole workspace for every read.
export let createAgentStatePublisher = (publish: () => void, intervalMs = 250) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel = () => { clearTimeout(timer); timer = undefined }
  let request = () => {
    if (timer) return
    timer = setTimeout(() => { timer = undefined; publish() }, intervalMs)
    timer.unref?.()
  }
  return { request, cancel }
}
