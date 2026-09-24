import type { PluginContext } from '../shared/plugins'

type Options = {
  context: (target: PluginContext) => PluginContext
  cdp: (tab: string, method: string, args?: Record<string, unknown>) => Promise<any>
  execute: (command: { method: string; args?: Record<string, unknown> }) => Promise<unknown>
}
// Object handles belong to one execution context. A navigation cannot redirect a
// delayed credential fill or evaluation into the replacement document.
export let createPluginBrowser = (options: Options) => async (method: string, args: Record<string, unknown>, context: PluginContext, signal: AbortSignal) => {
  let validate = () => {
    signal.throwIfAborted()
    let current = options.context(context)
    if (!context.paneId || !context.documentId || current.documentId !== context.documentId || current.url !== context.url) throw new Error('Document changed')
  }
  let evaluate = async (expression: string) => {
    validate()
    let reference = await options.cdp(context.paneId!, 'Runtime.evaluate', { expression: 'globalThis', returnByValue: false })
    let objectId = reference.result.objectId
    try {
      validate()
      let response = await options.cdp(context.paneId!, 'Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(source) { return (0, eval)(source) }', arguments: [{ value: expression }], returnByValue: true, awaitPromise: true, timeout: 15000 })
      if (response.exceptionDetails) throw new Error('Page script failed')
      return response.result.value ?? null
    } finally { if (objectId) void options.cdp(context.paneId!, 'Runtime.releaseObject', { objectId }).catch(() => undefined) }
  }
  if (method === 'dom') return { pane: context.paneId, url: context.url, content: await evaluate(args.html === true ? 'document.documentElement.outerHTML' : 'document.body?.innerText ?? ""') }
  if (method === 'eval') { if (typeof args.expression !== 'string') throw new Error('Expression required'); return evaluate(args.expression) }
  if (method.startsWith('forms.')) {
    validate()
    return options.execute({ method, args: { ...args, pane: context.paneId, _formsContext: context, _formsSignal: signal } })
  }
  if (method === 'wait') {
    let timeout = Math.min(60000, Math.max(1, Number(args.timeout) || 15000)), end = Date.now() + timeout
    if (typeof args.selector !== 'string' && typeof args.expression !== 'string') throw new Error('Wait requires selector or expression')
    let expression = typeof args.selector === 'string' ? `!!document.querySelector(${JSON.stringify(args.selector)})` : String(args.expression)
    while (Date.now() < end) { if (await evaluate(expression)) return { matched: true }; await new Promise<void>(resolve => setTimeout(resolve, 100)) }
    throw new Error('Wait timed out')
  }
  if (method === 'fill' || method === 'type' || method === 'click') {
    if (method === 'fill' && (typeof args.origin !== 'string' || args.origin !== new URL(context.url!).origin)) throw new Error('Fill requires the original origin')
    let fields = method === 'fill' ? args.fields : [{ selector: args.selector, value: args.text }]
    if (!Array.isArray(fields) || !fields.length || fields.length > 50) throw new Error('Fields required')
    for (let field of fields) if (!field || typeof field.selector !== 'string' || (method !== 'click' && typeof field.value !== 'string')) throw new Error('Invalid field')
    await evaluate(`(() => {
      let fields = ${JSON.stringify(fields)}, mode = ${JSON.stringify(method)};
      let nodes = fields.map(field => document.querySelector(field.selector));
      if (nodes.some((node, index) => fields[index].expectedType && node?.type !== fields[index].expectedType)) throw new Error('Form field type changed');
      if (nodes.some((node, index) => fields[index].requireEmpty && node?.value)) throw new Error('Field already contains a value');
      if (nodes.some((node, index) => fields[index].loginPassword && (node?.type !== 'password' || node.autocomplete.split(/\\s+/).includes('new-password')))) throw new Error('Login password field changed');
      if (nodes.some(node => !node || !node.getClientRects().length || getComputedStyle(node).visibility !== 'visible' || node.disabled || node.readOnly || (mode !== 'click' && (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) || node.type === 'hidden')))) throw new Error('Visible editable fields required');
      nodes.forEach((node, index) => {
        if (mode === 'click') { node.click(); return; }
        let setter = Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
        let value = fields[index].value;
        if (mode === 'type') value = node.value.slice(0, node.selectionStart ?? node.value.length) + value + node.value.slice(node.selectionEnd ?? node.value.length);
        setter.call(node, value);
        node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
      }); return true;
    })()`)
    return { filled: fields.length }
  }
  if (method === 'cdp') {
    validate()
    // Raw CDP is a trusted advanced capability. Exclude browser/target routing.
    if (typeof args.method !== 'string' || !/^(DOM|Runtime|Page|Input|Network|CSS|Accessibility|Emulation)\./.test(args.method) || args.sessionId !== undefined) throw new Error('Only tab-scoped CDP is supported')
    return options.cdp(context.paneId!, args.method, (args.params ?? {}) as Record<string, unknown>)
  }
  if (['navigate', 'back', 'forward', 'reload', 'key', 'screenshot'].includes(method)) {
    validate()
    return options.execute({ method, args: { ...args, pane: context.paneId, ...(method === 'navigate' ? { waitUntil: 'none' } : {}), _pluginGuard: validate } })
  }
  signal.throwIfAborted()
  return options.execute({ method, args: { ...args } })
}
