import { randomUUID } from 'node:crypto'

type Send = (method: string, params: Record<string, unknown>) => Promise<any>
type Pause = { callFrames: { callFrameId: string; functionName: string }[] }

// Pause inside the synchronous DOM API so scripts keep their original ordering
// and return values while the main process draws the pointer before the click.
export let withAgentScriptClicks = async <T>(method: string, params: Record<string, unknown>, send: Send, subscribe: (paused: (event: Pause) => void) => () => void, point: (target: Record<string, unknown>, visual: Send) => Promise<void>, operation: () => Promise<T>): Promise<T> => {
  let name = `bmuxAgentClick_${randomUUID().replaceAll('-', '')}`, failure: unknown, pending = Promise.resolve()
  let install = `function() {
    let prototype = globalThis.HTMLElement?.prototype;
    if (!prototype) return () => {};
    let descriptor = Object.getOwnPropertyDescriptor(prototype,'click'), original = descriptor.value;
    function ${name}(...args) {
      let proceed = true;
      debugger;
      if (!proceed) throw new Error('Agent click cancelled');
      return Reflect.apply(original,this,args);
    }
    Object.defineProperty(prototype,'click',{...descriptor,value:${name}});
    return () => { if (prototype.click === ${name}) Object.defineProperty(prototype,'click',descriptor); };
  }`
  let unsubscribe = subscribe(event => {
    pending = (async () => {
      let frame = event.callFrames.find(frame => frame.functionName === name)
      try {
        if (!frame) return
        let evaluate: Send = (_method, args) => send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, ...args })
        let result = await evaluate('Runtime.evaluate', { expression: `(() => {
          if (!this.isConnected || getComputedStyle(this).visibility !== 'visible') return null;
          this.scrollIntoView({block:'nearest',inline:'nearest'});
          let rect = this.getBoundingClientRect();
          return rect.width && rect.height ? {x:Math.max(0,Math.min(innerWidth-1,rect.x+rect.width/2)),y:Math.max(0,Math.min(innerHeight-1,rect.y+rect.height/2))} : null;
        })()`, returnByValue: true })
        if (result.exceptionDetails) throw new Error('Cannot locate agent click target')
        if (result.result.value) await point(result.result.value, (method, args) => method === 'Runtime.evaluate' ? evaluate(method, args) : Promise.resolve({}))
      } catch (error) {
        failure = error
        if (frame) await send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression: 'proceed = false' }).catch(() => undefined)
      } finally { await send('Debugger.resume', {}).catch(() => undefined) }
    })()
  })
  let cleanup: string | undefined
  try {
    await send('Debugger.enable', {})
    let result = method === 'Runtime.evaluate'
      ? await send('Runtime.evaluate', { expression: `(${install})()`, ...(params.contextId !== undefined ? { contextId: params.contextId } : {}), ...(params.uniqueContextId ? { uniqueContextId: params.uniqueContextId } : {}) })
      : await send('Runtime.callFunctionOn', { functionDeclaration: install, ...(params.objectId ? { objectId: params.objectId } : { executionContextId: params.executionContextId }) })
    if (result.exceptionDetails || !result.result.objectId) throw new Error('Cannot prepare agent script clicks')
    cleanup = result.result.objectId
    let value = await operation()
    await pending
    if (failure) throw failure
    return value
  } finally {
    await pending
    if (cleanup) {
      await send('Runtime.callFunctionOn', { objectId: cleanup, functionDeclaration: 'function() { this() }' }).catch(() => undefined)
      await send('Runtime.releaseObject', { objectId: cleanup }).catch(() => undefined)
    }
    await send('Debugger.disable', {}).catch(() => undefined)
    unsubscribe()
  }
}
