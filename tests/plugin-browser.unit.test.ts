import { expect, test, vi } from 'vitest'
import { createPluginBrowser } from '../src/main/plugin-browser'

let fixture = () => {
  let context = { paneId: 'pane', documentId: 'document-1', url: 'https://example.test/' }
  let current = { ...context }, controller = new AbortController()
  let cdp = vi.fn(async (_pane: string, method: string, _args?: Record<string, unknown>): Promise<any> => {
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'original-frame' } } }
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 17 }
    return {}
  })
  let before = vi.fn(), action = vi.fn(async (_pane, _method, _args, operation) => operation()), read = vi.fn(async (_pane, operation) => operation())
  let browser = createPluginBrowser({ context: () => current, cdp, execute: vi.fn(), before, action, read })
  let install = () => browser('script.install', { source: 'window.addEventListener("keydown", () => {})', worldName: 'test-helper' }, context, controller.signal)
  return { browser, context, current, controller, cdp, before, action, read, install }
}

test('page helper installation stays in its isolated document without agent activity', async () => {
  let { install, cdp, before, action, read } = fixture()
  expect(await install()).toEqual({ installed: true })
  expect(cdp.mock.calls).toEqual([
    ['pane', 'Page.getFrameTree'],
    ['pane', 'Page.createIsolatedWorld', { frameId: 'original-frame', worldName: 'test-helper' }],
    ['pane', 'Runtime.evaluate', { expression: 'window.addEventListener("keydown", () => {})', contextId: 17 }],
  ])
  expect(before).not.toHaveBeenCalled()
  expect(action).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
})

for (let stage of ['Page.getFrameTree', 'Page.createIsolatedWorld']) test(`page helper installation stops when the document changes during ${stage}`, async () => {
  let { install, current, cdp } = fixture(), send = cdp.getMockImplementation()!
  cdp.mockImplementation(async (...args) => {
    if (args[1] === stage) current.documentId = 'document-2'
    return send(...args)
  })
  await expect(install()).rejects.toThrow('Document changed')
  expect(cdp.mock.calls.some(([, method]) => method === 'Runtime.evaluate')).toBe(false)
})

test('ordinary plugin CDP operations retain agent guards and reading feedback', async () => {
  let { browser, context, controller, before, action, read } = fixture()
  await browser('cdp', { method: 'Runtime.evaluate', params: { expression: 'document.title' } }, context, controller.signal)
  expect(before).toHaveBeenCalledWith(context, 'cdp', expect.any(Object))
  expect(action).toHaveBeenCalledOnce()
  expect(read).toHaveBeenCalledOnce()
})


test('plugin observations retain page guards and reading feedback without acquiring an action lock', async () => {
  let { browser, context, controller, before, action, read, cdp } = fixture()
  cdp.mockImplementation(async (_pane, method) => method === 'Runtime.evaluate' ? { result: { objectId: 'document-global' } } : { result: { value: 'observed post' } })
  expect(await browser('eval', { expression: 'document.title', observation: true }, context, controller.signal)).toBe('observed post')
  expect(before).toHaveBeenCalledWith(context, 'eval', expect.objectContaining({ observation: true }))
  expect(action).not.toHaveBeenCalled()
  expect(read).toHaveBeenCalledOnce()
  expect(cdp).toHaveBeenCalledWith('pane', 'Runtime.callFunctionOn', expect.objectContaining({ objectId: 'document-global' }))
})

test('an observation cannot cross a document replacement during its guard', async () => {
  let { browser, context, current, controller, before, cdp } = fixture()
  before.mockImplementation(async () => { current.documentId = 'replacement' })
  await expect(browser('eval', { expression: 'document.title', observation: true }, context, controller.signal)).rejects.toThrow('Document changed')
  expect(cdp).not.toHaveBeenCalled()
})
