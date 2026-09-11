import { createRequire } from 'node:module'
import path from 'node:path'

let require = createRequire(import.meta.url)
let native: { move: (x: number, y: number) => boolean } | undefined

export let movePointer = (point: { x: number; y: number }) => {
  if (process.platform !== 'darwin') return false
  native ??= require(path.join(import.meta.dirname, '../native/pointer.node'))
  if (!native!.move(point.x, point.y)) throw new Error('macOS could not move the pointer')
  return true
}
