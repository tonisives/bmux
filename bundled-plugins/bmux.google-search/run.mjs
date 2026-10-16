import { readFile } from 'node:fs/promises'
import { host, finish } from '../host.mjs'

await finish(async () => {
  let context = await host('context'), url = new URL(context.url)
  if (url.protocol !== 'https:' || !/^(?:www\.)?google\.(?:com|[a-z]{2}|(?:com|co)\.[a-z]{2})$/.test(url.hostname) || url.pathname !== '/search') return
  let source = await readFile(new URL('./navigation.js', import.meta.url), 'utf8')
  let { frameTree } = await host('cdp', { method: 'Page.getFrameTree' })
  let { executionContextId } = await host('cdp', { method: 'Page.createIsolatedWorld', params: { frameId: frameTree.frame.id, worldName: 'bmux:google-search' } })
  let response = await host('cdp', { method: 'Runtime.evaluate', params: { expression: source, contextId: executionContextId } })
  if (response.exceptionDetails) throw new Error('Could not install Google result navigation')
})
