import fs from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { FiltersEngine } from '@ghostery/adblocker'

let sources = ['https://easylist.to/easylist/easylist.txt', 'https://easylist.to/easylist/easyprivacy.txt']
let lists = await Promise.all(sources.map(async url => {
  let response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error('Filter download failed')
  let text = await response.text()
  if (!text.startsWith('[Adblock Plus') || text.length < 10000) throw new Error('Invalid filter list')
  return text
}))
let engine = FiltersEngine.parse(lists.join('\n'), { loadExtendedSelectors: false })
let directory = path.resolve('resources')
await fs.mkdir(directory, { recursive: true })
await fs.writeFile(path.join(directory, 'adblock.bin.gz'), gzipSync(engine.serialize()))
await fs.writeFile(path.join(directory, 'adblock.json'), JSON.stringify({ updatedAt: Date.now(), sources, engine: '2.18.2' }, null, 2) + '\n')
let { networkFilters, cosmeticFilters } = engine.getFilters()
console.log(`Bundled ${networkFilters.length} network filters and ${cosmeticFilters.length} cosmetic filters`)
