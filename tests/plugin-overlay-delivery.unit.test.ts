import { expect, test, vi } from 'vitest'
import { createPluginOverlayDelivery, setPluginOverlayGeometry } from '../src/main/plugin-overlay-delivery'
import type { PluginOverlayState } from '../src/shared/plugin-overlay'

test('four overlay recipients receive only their changed payloads and clear once', () => {
  let send = vi.fn(), deliver = createPluginOverlayDelivery(send)
  let targets = [{}, {}, {}, {}]
  let overlay = (pane: number): PluginOverlayState => ({ runId: `run-${pane}`, paneId: `%${pane}`, content: { title: 'Feed', subtitle: '', status: 'Browsing', nodes: [], metrics: '', details: [], controls: [] }, bounds: { x: 0, y: 0, width: 384, height: 600 }, zoom: 1, ended: false })
  for (let index = 0; index < 4; index++) deliver(targets[index], overlay(index))
  expect(send).toHaveBeenCalledTimes(4)
  send.mockClear()
  for (let index = 0; index < 4; index++) deliver(targets[index], overlay(index))
  expect(send).not.toHaveBeenCalled()
  let updated = overlay(2); updated.content.status = 'Paused'
  deliver(targets[2], updated)
  expect(send).toHaveBeenCalledExactlyOnceWith(targets[2], updated)
  expect(JSON.stringify(send.mock.calls[0][1]).length).toBeLessThan(1024)
  send.mockClear()
  deliver(targets[2], undefined); deliver(targets[2], undefined)
  expect(send).toHaveBeenCalledExactlyOnceWith(targets[2], undefined)
})

test('overlay content updates leave unchanged native geometry alone', () => {
  let bounds = { x: 12, y: 16, width: 384, height: 600 }, zoom = 1
  let view = { getBounds: () => bounds, setBounds: vi.fn(next => { bounds = next }), webContents: { getZoomFactor: () => zoom, setZoomFactor: vi.fn(next => { zoom = next }) } }
  for (let frame = 0; frame < 100; frame++) setPluginOverlayGeometry(view, { ...bounds }, 1)
  expect(view.setBounds).not.toHaveBeenCalled()
  expect(view.webContents.setZoomFactor).not.toHaveBeenCalled()
  setPluginOverlayGeometry(view, { ...bounds, width: 576 }, 1.5)
  expect(view.setBounds).toHaveBeenCalledOnce()
  expect(view.webContents.setZoomFactor).toHaveBeenCalledExactlyOnceWith(1.5)
  setPluginOverlayGeometry(view, { ...bounds }, 1.5)
  expect(view.setBounds).toHaveBeenCalledOnce()
  expect(view.webContents.setZoomFactor).toHaveBeenCalledOnce()
})
