import { createRequire } from 'node:module'
import path from 'node:path'
import type { BaseWindow, Rectangle, WebContents } from 'electron'

type Native = { clip: (id: number, handle: Buffer, ...bounds: number[]) => void; clear: (id: number) => void }
let require = createRequire(import.meta.url), native: Native | undefined
let clipped = new WeakMap<WebContents, number>()
export let clipViewportInput = (contents: WebContents, window: BaseWindow, frame: Rectangle, page: Rectangle) => {
  if (process.platform !== 'darwin' || window.isDestroyed() || !window.isVisible()) return
  native ??= require(path.join(import.meta.dirname, '../native/viewport-input.node')) as Native
  clipped.set(contents, contents.id)
  native.clip(contents.id, window.getNativeWindowHandle(), frame.x, frame.y, frame.width, frame.height, page.x, page.y, page.width, page.height)
}
export let clearViewportInput = (contents: WebContents) => {
  let id = clipped.get(contents)
  if (id !== undefined) native?.clear(id)
  clipped.delete(contents)
}
