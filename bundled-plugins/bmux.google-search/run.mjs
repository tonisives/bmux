import { readFile } from 'node:fs/promises'
import { host, finish } from '../host.mjs'

await finish(async () => {
  let context = await host('context'), url = new URL(context.url)
  if (url.protocol !== 'https:' || !/^(?:www\.)?google\.(?:com|[a-z]{2}|(?:com|co)\.[a-z]{2})$/.test(url.hostname) || url.pathname !== '/search') return
  let source = await readFile(new URL('./navigation.js', import.meta.url), 'utf8')
  await host('script.install', { source, worldName: 'bmux:google-search' })
})
