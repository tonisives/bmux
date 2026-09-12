import { test, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { createFrameCosmetics } from '../src/main/frame-cosmetics'

let fixture = () => {
  let events = new EventEmitter(), enabled = true, sheets = new Map<string, string>(), sequence = 0
  let frame = { id: 'child', parentId: 'main', loaderId: 'first', url: 'https://frame.example.test/' }
  let contents = Object.assign(new EventEmitter(), { debugger: events, isDestroyed: () => false, getURL: () => 'https://page.example.test/' }) as unknown as WebContents
  let send = vi.fn(async (method: string, params: Record<string, any> = {}): Promise<any> => {
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', loaderId: 'main', url: contents.getURL() }, childFrames: [{ frame: { ...frame } }] } }
    if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'main' } }
    if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'unrelated', parentId: 'another-tab', url: 'https://unrelated.test/' }, { targetId: 'unowned', url: 'https://unowned.test/' }] }
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 }
    if (method === 'Runtime.evaluate') return { result: { value: { url: frame.url, ids: [], classes: ['ad'] } } }
    if (method === 'CSS.createStyleSheet') { let styleSheetId = String(++sequence); sheets.set(styleSheetId, ''); return { styleSheetId } }
    if (method === 'CSS.setStyleSheetText') sheets.set(params.styleSheetId, params.text)
    return {}
  })
  let tools = createFrameCosmetics({ contents, send, enabled: () => enabled, styles: url => `${url.includes('frame.') ? '.frame-ad' : '.parent-ad'}{display:none!important}` })
  return { events, sheets, send, tools, frame, disable: () => { enabled = false } }
}

test('clears the existing sheet after same-document navigation and transient context failure', async () => {
  let fixtureState = fixture(), { tools, frame, send, sheets } = fixtureState
  try {
    await tools.refresh()
    expect([...sheets.values()]).toEqual(['.frame-ad{display:none!important}'])
    frame.url += '#next'
    let implementation = send.getMockImplementation()!
    send.mockImplementation(async (method, params) => { if (method === 'Runtime.evaluate') throw new Error('Context disappeared'); return implementation(method, params) })
    await tools.refresh()
    send.mockImplementation(implementation)
    await tools.refresh()
    fixtureState.disable(); await tools.refresh()
    expect([...sheets.values()]).toEqual([''])
    expect(send.mock.calls.some(([method]) => method === 'Target.attachToTarget' || method === 'Target.setAutoAttach')).toBe(false)
  } finally { tools.close() }
})

test('drops old-document work when a frame navigates during token collection', async () => {
  let { tools, frame, send, sheets, events } = fixture()
  let resolve: (value: any) => void = () => undefined
  let started: () => void = () => undefined, collecting = new Promise<void>(done => { started = done })
  let implementation = send.getMockImplementation()!
  send.mockImplementation(async (method, params) => {
    if (method !== 'Runtime.evaluate') return implementation(method, params)
    started(); return new Promise(done => { resolve = done })
  })
  try {
    let refresh = tools.refresh(); await collecting
    let previous = frame.url
    frame.loaderId = 'second'; frame.url = 'https://other.example.test/'
    events.emit('message', {}, 'Page.frameNavigated', { frame: { ...frame } })
    resolve({ result: { value: { url: previous, ids: [], classes: ['ad'] } } })
    await refresh
    expect(sheets.size).toBe(0)
    send.mockImplementation(implementation); await tools.refresh()
    expect([...sheets.values()]).toEqual(['.parent-ad{display:none!important}'])
  } finally { tools.close() }
})

test('disposal abandons pending work and removes protocol listeners', async () => {
  let { tools, send, sheets, events } = fixture()
  let implementation = send.getMockImplementation()!
  send.mockImplementation(async (method, params) => {
    if (method === 'Runtime.evaluate') tools.close()
    return implementation(method, params)
  })
  await tools.refresh()
  expect(sheets.size).toBe(0)
  expect(events.listenerCount('message')).toBe(0)
  expect(events.listenerCount('detach')).toBe(0)
  let commands = send.mock.calls.length
  await tools.refresh()
  expect(send.mock.calls.length).toBe(commands)
})
