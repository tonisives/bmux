import { parentPort, workerData } from 'node:worker_threads'
import { gzipSync } from 'node:zlib'
import { FiltersEngine } from '@ghostery/adblocker'

try {
  let engine = FiltersEngine.parse(workerData.texts.join('\n'), { loadExtendedSelectors: false })
  parentPort!.postMessage({ data: gzipSync(engine.serialize()) })
} catch { parentPort!.postMessage({ error: 'Could not compile filter lists' }) }
