import type { WebContents } from 'electron'
import { pageOrigin } from '../shared/browser-tools'

type FrameTree = { frame: { id: string; parentId?: string; loaderId: string; url: string }; childFrames?: FrameTree[] }
type FrameStyle = { loaderId: string; url: string; css?: string; key?: string }
type Session = { id?: string; parent?: string; targetId?: string; frames: Map<string, FrameStyle>; documents: Map<string, FrameTree['frame']>; ready?: Promise<void> }
type TargetInfo = { targetId: string; parentId?: string; parentFrameId?: string; url: string }
type Options = {
  contents: WebContents
  send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>
  enabled: () => boolean
  styles: (url: string, ids: string[], classes: string[]) => string
}

// Read only DOM tokens in a separate world; frames receive no browser APIs.
export let cosmeticTokens = `(() => {
  let ids = new Set(), classes = new Set();
  for (let node of document.querySelectorAll('[id],[class]')) { if (ids.size + classes.size > 2000) break; if (node.id) ids.add(node.id); for (let name of node.classList) classes.add(name); }
  return { url: location.href, ids: [...ids], classes: [...classes] };
})()`

export let createFrameCosmetics = (options: Options) => {
  let sessions = new Map<string, Session>(), closed = false, pending = false, work: Promise<void> | undefined, timer: ReturnType<typeof setTimeout> | undefined
  let root: Session = { frames: new Map(), documents: new Map() }
  sessions.set('', root)
  let current = (session: Session) => !closed && !options.contents.isDestroyed() && sessions.get(session.id ?? '') === session
  let initialize = (session: Session): Promise<void> => session.ready ??= (async () => {
    await options.send('Page.enable', {}, session.id)
    await options.send('DOM.enable', {}, session.id)
    await options.send('CSS.enable', {}, session.id)
    if (!session.id) session.targetId = (await options.send('Target.getTargetInfo')).targetInfo.targetId
  })().catch(error => { session.ready = undefined; throw error })
  let discover = async () => {
    let { targetInfos } = await options.send('Target.getTargets', { filter: [{ type: 'iframe' }, { exclude: true }] }) as { targetInfos: TargetInfo[] }
    if (closed) return
    for (let session of sessions.values()) if (session.id && !targetInfos.some(info => info.targetId === session.targetId)) remove(session.id)
    let remaining = targetInfos.filter(info => ![...sessions.values()].some(session => session.targetId === info.targetId))
    for (let previous = -1; remaining.length && remaining.length !== previous && !closed;) {
      previous = remaining.length
      for (let info of [...remaining]) {
        if (!info.url) continue
        let parent = [...sessions.values()].find(session => !!info.parentId && session.targetId === info.parentId || !!info.parentFrameId && session.documents.has(info.parentFrameId))
        if (!parent) continue
        remaining = remaining.filter(item => item !== info)
        // Attach only descendants of this tab, after creation. Auto-attachment can
        // race another debugger's initialization and leave nested frames paused.
        try {
          let { sessionId } = await options.send('Target.attachToTarget', { targetId: info.targetId, flatten: true })
          if (!closed) sessions.set(sessionId, { id: sessionId, parent: parent.id ?? '', targetId: info.targetId, frames: new Map(), documents: new Map() })
        } catch { /* A frame can disappear before attachment. */ }
      }
    }
  }
  let documentUrl = (id: string, seen = new Set<string>()): string => {
    if (seen.has(id)) return ''
    seen.add(id)
    for (let session of sessions.values()) {
      let frame = session.documents.get(id)
      if (!frame) continue
      if (pageOrigin(frame.url)) return frame.url
      if (frame.parentId && /^about:(blank|srcdoc)(?:[?#]|$)/.test(frame.url)) return documentUrl(frame.parentId, seen)
    }
    return ''
  }
  let apply = async (session: Session, tree: FrameTree, inheritedUrl: string, main: boolean) => {
    let { id, loaderId, url } = tree.frame
    let effectiveUrl = pageOrigin(url) ? url : /^about:(blank|srcdoc)(?:[?#]|$)/.test(url) ? inheritedUrl : ''
    if (!main && current(session)) {
      let frame = session.frames.get(id)
      if (!frame || frame.loaderId !== loaderId) {
        frame = { loaderId, url }; session.frames.set(id, frame)
      }
      frame.url = url
      let active = () => current(session) && session.frames.get(id) === frame && frame.url === url
      try {
        let css = ''
        if (effectiveUrl && options.enabled()) {
          let { executionContextId } = await options.send('Page.createIsolatedWorld', { frameId: id, worldName: 'bmux:frame-cosmetics' }, session.id)
          let { result, exceptionDetails } = await options.send('Runtime.evaluate', { contextId: executionContextId, expression: cosmeticTokens, returnByValue: true, timeout: 1000 }, session.id)
          if (!active() || exceptionDetails || result?.value?.url !== url) return
          css = options.styles(effectiveUrl, result.value.ids, result.value.classes)
        }
        if (!active()) return
        if (!options.enabled()) css = ''
        if (frame.css !== css) {
          if (!frame.key && css.trim()) {
            // Inspector sheets work under strict CSP without changing the policy.
            let { styleSheetId } = await options.send('CSS.createStyleSheet', { frameId: id, force: true }, session.id)
            if (!active()) return
            frame.key = styleSheetId
          }
          if (frame.key) await options.send('CSS.setStyleSheetText', { styleSheetId: frame.key, text: css }, session.id)
          if (active()) frame.css = css
        }
      } catch {
        // Keep the sheet handle across transient failures so disabling can clear it.
        if (active()) frame.css = undefined
      }
    }
    for (let child of tree.childFrames ?? []) await apply(session, child, effectiveUrl, false)
  }
  let scan = async (session: Session) => {
    if (!current(session)) return
    await initialize(session)
    let { frameTree } = await options.send('Page.getFrameTree', {}, session.id) as { frameTree: FrameTree }
    if (!current(session)) return
    session.documents.clear()
    let collect = (tree: FrameTree) => { session.documents.set(tree.frame.id, tree.frame); for (let child of tree.childFrames ?? []) collect(child) }
    collect(frameTree)
    for (let id of session.frames.keys()) if (!session.documents.has(id)) session.frames.delete(id)
    let parentUrl = frameTree.frame.parentId ? documentUrl(frameTree.frame.parentId) : options.contents.getURL()
    await apply(session, frameTree, parentUrl, !session.id)
  }
  let refresh = (): Promise<void> => {
    if (closed) return Promise.resolve()
    pending = true
    work ??= (async () => {
      while (pending && !closed) {
        pending = false
        await scan(root).catch(() => undefined)
        await discover().catch(() => undefined)
        // Each renderer is independent; a disappearing child must not skip siblings.
        let queue = [...sessions.values()].filter(session => session.id)
        await Promise.allSettled(Array.from({ length: Math.min(4, queue.length) }, async () => {
          while (queue.length && !closed) { let session = queue.shift()!; await scan(session).catch(() => undefined) }
        }))
      }
    })().finally(() => { work = undefined })
    return work
  }
  let schedule = () => {
    if (closed || timer) return
    timer = setTimeout(() => { timer = undefined; void refresh() }, 100)
    timer.unref()
  }
  let remove = (id: string) => {
    if (!sessions.has(id)) return
    sessions.delete(id)
    for (let session of sessions.values()) if (session.parent === id) remove(session.id!)
  }
  let message = (_event: unknown, method: string, params: any, sessionId?: string) => {
    if (closed) return
    let session = sessions.get(sessionId ?? '')
    if (!session) return
    if (method === 'Target.detachedFromTarget') remove(params.sessionId)
    else if (method === 'Page.frameNavigated' || method === 'Page.frameDetached') {
      session.frames.delete(params.frame?.id ?? params.frameId)
      session.documents.delete(params.frame?.id ?? params.frameId)
      schedule()
    } else if (method === 'Page.frameStoppedLoading' || method === 'Page.navigatedWithinDocument') schedule()
    else if (method === 'CSS.styleSheetRemoved') {
      for (let frame of session.frames.values()) if (frame.key === params.styleSheetId) { frame.key = undefined; frame.css = undefined }
    }
  }
  let detached = () => {
    sessions.clear(); root = { frames: new Map(), documents: new Map() }; sessions.set('', root)
  }
  options.contents.debugger.on('message', message)
  options.contents.debugger.on('detach', detached)
  options.contents.on('did-frame-finish-load', schedule)
  options.contents.on('did-frame-navigate', schedule)
  return {
    start: () => initialize(root),
    refresh,
    close: () => {
      if (closed) return
      closed = true; clearTimeout(timer)
      options.contents.debugger.off('message', message); options.contents.debugger.off('detach', detached)
      options.contents.off('did-frame-finish-load', schedule); options.contents.off('did-frame-navigate', schedule)
      sessions.clear()
      // This owner is disposed only when its tab closes. Release the whole debugger
      // once; detaching an already-removed child inside its event can reenter CDP.
      if (options.contents.debugger.isAttached()) options.contents.debugger.detach()
    },
  }
}
