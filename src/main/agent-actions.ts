import { AsyncLocalStorage } from 'node:async_hooks'

type Input = { owner: string; type: 'down' | 'up' | 'continue'; key?: string }
type Lease = { owner: string; keys: Set<string>; release: () => Promise<void>; timer: ReturnType<typeof setTimeout> }

export let agentAction = (method: string, args: Record<string, unknown> = {}) => {
  if (['navigate', 'back', 'forward', 'reload', 'hard-reload', 'history.go-to', 'click', 'scroll', 'type', 'key', 'fill', 'forms.fill', 'eval'].includes(method)) return true
  return method === 'cdp' && /^(Input\.|Runtime\.(evaluate|callFunctionOn)|Page\.(navigate|reload)|DOM\.(set|remove|move|copy|focus|scrollIntoView))/.test(String(args.method))
}

export let agentActionInput = (method: string, args: Record<string, unknown>, owner = ''): Input | undefined => {
  if (method !== 'cdp') return
  let params = (args.params ?? {}) as Record<string, unknown>, type = String(params.type)
  if (args.method === 'Input.dispatchMouseEvent') {
    if (type === 'mousePressed' || type === 'mouseReleased') return { owner, type: type === 'mousePressed' ? 'down' : 'up', key: `mouse:${params.button ?? 'left'}` }
    if (type === 'mouseMoved' || type === 'mouseWheel') return { owner, type: 'continue' }
  }
  if (args.method === 'Input.dispatchKeyEvent') {
    if (['rawKeyDown', 'keyDown', 'keyUp'].includes(type)) return { owner, type: type === 'keyUp' ? 'up' : 'down', key: `key:${params.code ?? params.key ?? params.windowsVirtualKeyCode}` }
    if (type === 'char') return { owner, type: 'continue' }
  }
  if (args.method === 'Input.insertText') return { owner, type: 'continue' }
}

export let createAgentActions = (sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), random = Math.random) => {
  let scope = new AsyncLocalStorage<string>(), tails = new Map<string, Promise<void>>(), inputs = new Map<string, Lease>()
  let keysFor = (pane: string, profileId: string, urls: string[]) => [...new Set([`pane:${pane}`, ...urls.flatMap(value => {
    try { let url = new URL(value); return /^https?:$/.test(url.protocol) ? [`domain:${JSON.stringify([profileId, url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')])}`] : [] } catch { return [] }
  })])].sort()
  let acquire = async (keys: string[]) => {
    let previous = Promise.all(keys.map(key => tails.get(key) ?? Promise.resolve()))
    let release!: () => void, done = new Promise<void>(resolve => { release = resolve }), tail = previous.then(() => done)
    for (let key of keys) tails.set(key, tail)
    void tail.then(() => { for (let key of keys) if (tails.get(key) === tail) tails.delete(key) })
    await previous
    return release
  }
  let cooldown = async (release: () => void) => { try { await sleep(800 + random() * 400) } finally { release() } }
  let finishInput = async (pane: string, lease: Lease) => {
    if (inputs.get(pane) !== lease) return
    inputs.delete(pane); clearTimeout(lease.timer)
    await lease.release()
  }
  let run = async <T>(pane: string, profileId: string, urls: () => string[], operation: () => Promise<T>, input?: Input): Promise<T> => {
    if (scope.getStore() === pane) return operation()
    let held = inputs.get(pane)
    if (held && input?.owner === held.owner) {
      try {
        let result = await scope.run(pane, operation)
        if (input.type === 'down') held.keys.add(input.key!)
        if (input.type === 'up') { held.keys.delete(input.key!); if (!held.keys.size) await finishInput(pane, held) }
        return result
      } catch (error) { await finishInput(pane, held); throw error }
    }
    if (input?.type === 'up') {
      if (held) throw new Error('This page input belongs to another agent')
      // Releases must reach the page immediately, even if another action is queued.
      return scope.run(pane, operation)
    }
    let release!: () => void
    while (true) {
      let keys = keysFor(pane, profileId, urls())
      release = await acquire(keys)
      try { if (JSON.stringify(keys) === JSON.stringify(keysFor(pane, profileId, urls()))) break } catch (error) { release(); throw error }
      release()
    }
    let retained = false
    try {
      let result = await scope.run(pane, operation)
      if (input?.type === 'down') {
        let lease: Lease = { owner: input.owner, keys: new Set([input.key!]), release: () => cooldown(release), timer: setTimeout(() => { void finishInput(pane, lease) }, 20_000) }
        lease.timer.unref?.(); inputs.set(pane, lease); retained = true
      }
      return result
    } finally { if (!retained) await cooldown(release) }
  }
  return { run }
}
