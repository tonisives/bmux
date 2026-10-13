import type { WebContents } from 'electron'
import type { BookmarkPluginAttachment, BookmarkPluginContribution } from '../shared/plugins'
import { bookmarkPluginValues, matchesBookmarkPlugin } from '../shared/bookmark-plugins'
import { mountBookmarkPluginOverlay } from './bookmark-plugin-overlay'

type Definition = { id: string; name: string; contribution: BookmarkPluginContribution; source: string; error?: string }
type Options = { definitions: () => Definition[]; attachments: (tabId: string) => BookmarkPluginAttachment[]; cdp: (tabId: string, method: string, args?: Record<string, unknown>) => Promise<any>; update: (tabId: string, attachment: BookmarkPluginAttachment) => Promise<unknown>; changed: () => void }
type Target = { contents: WebContents; revision: number; contextId?: number; work: Promise<void>; message: (event: unknown, method: string, args: any) => void }
let world = 'bmux:bookmark-plugins', binding = '__bmuxBookmarkSettings'
export let createBookmarkPluginPages = (options: Options) => {
  let targets = new Map<string, Target>(), errors: Record<string, string> = {}
  let refresh = (tabId: string) => {
    let target = targets.get(tabId)
    if (!target || target.contents.isDestroyed()) return Promise.resolve()
    let revision = ++target.revision
    target.work = target.work.catch(() => undefined).then(async () => {
      let current = () => targets.get(tabId) === target && revision === target.revision && !target.contents.isDestroyed()
      if (!current()) return
      let attachments = options.attachments(tabId), url = target.contents.getURL(), definitions = options.definitions()
      let entries = (/^https?:/.test(url) ? attachments : []).flatMap<{ attachment: BookmarkPluginAttachment; name: string; contribution?: BookmarkPluginContribution; source: string; error?: string }>(attachment => {
        let definition = definitions.find(item => item.id === attachment.id)
        if (definition && !matchesBookmarkPlugin(definition.contribution.matches, url)) return []
        if (!definition) return [{ attachment, name: attachment.id, error: 'Plugin unavailable or disabled', source: '', contribution: undefined }]
        try { return [{ ...definition, attachment: { ...attachment, values: bookmarkPluginValues(definition.contribution, attachment.values) } }] }
        catch { return [{ ...definition, attachment, error: 'Plugin settings need updating' }] }
      })
      // No attachment means no CDP work on ordinary browser pages.
      if (!entries.length && target.contextId === undefined) return
      try {
        let { frameTree } = await options.cdp(tabId, 'Page.getFrameTree')
        if (!current()) return
        let { executionContextId } = await options.cdp(tabId, 'Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: world })
        if (!current()) return
        target.contextId = executionContextId
        await options.cdp(tabId, 'Runtime.addBinding', { name: binding, executionContextName: world })
        if (!current()) return
        let script = `(() => {
          globalThis.__bmuxBookmarkCleanup?.();
          let cleanups = [], errors = [], entries = ${JSON.stringify(entries.map(({ source: _source, ...entry }) => entry))};
          globalThis.__bmuxBookmarkCleanup = () => { for (let cleanup of cleanups.splice(0).reverse()) { try { cleanup(); } catch {} } };
          ${entries.filter(entry => entry.attachment.enabled && !entry.error && entry.source).map(entry => `try {
            let install = (${entry.source}\n);
            let cleanup = install(${JSON.stringify(entry.attachment.values)});
            if (typeof cleanup !== 'function') throw new Error('Cleanup function required');
            cleanups.push(cleanup);
          } catch { errors.push(${JSON.stringify(entry.name)}); entries.find(entry => entry.attachment.id === ${JSON.stringify(entry.attachment.id)}).error = 'Plugin could not run'; }`).join('\n')}
          ${entries.length ? `cleanups.push((${mountBookmarkPluginOverlay.toString()})(entries, value => globalThis.${binding}(value)));` : ''}
          return errors;
        })()`
        let response = await options.cdp(tabId, 'Runtime.evaluate', { expression: script, contextId: executionContextId, returnByValue: true, timeout: 1000 })
        if (!current()) return
        if (response.exceptionDetails) throw new Error('Bookmark plugin execution failed')
        let failed = response.result?.value as string[] | undefined
        if (failed?.length) errors[tabId] = `Could not run: ${failed.join(', ')}`
        else delete errors[tabId]
      } catch { if (current()) errors[tabId] = 'Bookmark plugins could not update this page' }
      options.changed()
    })
    return target.work
  }
  let attach = (tabId: string, contents: WebContents) => {
    let target: Target = { contents, revision: 0, work: Promise.resolve(), message: (_event, method, args) => {
      if (method !== 'Runtime.bindingCalled' || args.name !== binding || args.executionContextId !== target.contextId || typeof args.payload !== 'string' || args.payload.length > 16384) return
      try {
        let value = JSON.parse(args.payload) as BookmarkPluginAttachment
        if (!options.attachments(tabId).some(item => item.id === value.id)) return
        void options.update(tabId, { id: value.id, enabled: value.enabled, values: value.values }).catch(() => { errors[tabId] = 'Could not save plugin settings'; options.changed() })
      } catch { /* Ignore invalid page messages. */ }
    } }
    targets.set(tabId, target); contents.debugger.on('message', target.message)
  }
  let invalidate = (tabId: string) => { let target = targets.get(tabId); if (target) { ++target.revision; target.contextId = undefined }; delete errors[tabId] }
  let dispose = (tabId: string) => { let target = targets.get(tabId); if (!target) return; ++target.revision; target.contents.debugger.off('message', target.message); targets.delete(tabId); delete errors[tabId] }
  let refreshAll = () => Promise.all([...targets.keys()].map(refresh))
  return { attach, refresh, refreshAll, invalidate, dispose, errors: () => ({ ...errors }), close: () => { for (let tabId of targets.keys()) dispose(tabId) } }
}
