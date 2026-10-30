import type { WebContents } from 'electron'

type Contents = Pick<WebContents, 'isDestroyed' | 'isLoadingMainFrame' | 'getURL' | 'debugger'>

export let settlePageNavigation = async (contents: Contents, navigation: Promise<void>) => {
  try { await navigation } catch (error) {
    // Electron can stop a committed media document without did-finish-load and
    // reject loadURL with its synthetic ERR_FAILED, although the player is live.
    let failure = error as { code?: string; url?: string } | null
    if (failure?.code !== 'ERR_FAILED' || !failure.url || contents.isDestroyed() || contents.isLoadingMainFrame() || contents.getURL() !== failure.url) throw error
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
      let { frameTree } = await Promise.race([
        contents.debugger.sendCommand('Page.getFrameTree'),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(error), 1500) }),
      ])
      let frame = frameTree.frame
      if (contents.isDestroyed() || contents.getURL() !== failure.url || frame.url !== failure.url || !/^(audio|video)\//i.test(frame.mimeType)) throw error
    } catch { throw error } finally { clearTimeout(timer) }
  }
}

export let loadPage = (contents: WebContents, url: string, options?: Electron.LoadURLOptions) => settlePageNavigation(contents, contents.loadURL(url, options))

export let goToPageHistory = (contents: WebContents, index: number) => new Promise<void>((resolve, reject) => {
  let cleanup = () => { contents.off('did-finish-load', finish); contents.off('did-navigate-in-page', inPage); contents.off('did-fail-load', fail); contents.off('did-fail-provisional-load', fail); contents.off('destroyed', destroyed) }
  let finish = () => { cleanup(); resolve() }
  let inPage = (_event: Electron.Event, _url: string, mainFrame: boolean) => { if (mainFrame) finish() }
  let destroyed = () => { cleanup(); reject(new Error('Page closed while restoring history')) }
  let fail = (_event: Electron.Event, code: number, description: string, url: string, mainFrame: boolean) => {
    if (!mainFrame) return
    let reason = code === -3 ? 'ERR_ABORTED' : description
    cleanup(); reject(Object.assign(new Error(reason), { code: reason, url }))
  }
  contents.once('did-finish-load', finish)
  contents.on('did-navigate-in-page', inPage)
  contents.on('did-fail-load', fail)
  contents.on('did-fail-provisional-load', fail)
  contents.once('destroyed', destroyed)
  try { contents.navigationHistory.goToIndex(index) }
  catch (error) { cleanup(); reject(error) }
})
