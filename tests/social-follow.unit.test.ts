import { expect, test } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'

let source = fs.readFileSync('optional-plugins/bmux.x/follow.mjs', 'utf8').replace(/^import .*\n/, '')
let run = async (site: string, urls: string[], options: { cap?: boolean; already?: boolean; redirect?: string; confirm?: boolean; duplicate?: boolean } = {}) => {
  let calls: { method: string; args: Record<string, any> }[] = [], current = '', clicked = false, time = 0
  let spawnSync = (_command: string, argv: string[], input: { input: string }) => {
    let method = argv[3], args = JSON.parse(input.input)
    calls.push({ method, args })
    let result: unknown = null, error: string | undefined
    if (method === 'context') result = { url: current, parameters: { urls: JSON.stringify(urls) } }
    if (method === 'navigate') { current = options.redirect ?? args.url; clicked = false }
    if (method === 'eval') result = options.already || clicked && options.confirm !== false ? { following: true } : { x: 100, y: 100 }
    if (method === 'automation.follow' && options.cap) error = 'Weekly follow cap reached for x.com'
    if (method === 'automation.follow' && options.duplicate) error = 'Profile already reserved for follow this week'
    if (method === 'cdp' && args.params.type === 'mouseReleased') clicked = true
    return { stdout: JSON.stringify({ ok: !error, result, error }) }
  }
  let promise = vm.runInNewContext(`(async () => { ${source} })()`, { spawnSync, process: { argv: ['node', 'follow.mjs', site], execPath: 'node', env: { BMUX_CLI: '/fixture/bmux' } }, URL, Date: { now: () => time }, setTimeout: (resolve: () => void, ms: number) => { time += ms; resolve() } })
  try { await promise; return { calls, error: undefined } } catch (error) { return { calls, error: String(error) } }
}

test('social follow actions reserve before clicking, deduplicate profiles, and confirm success', async () => {
  for (let [site, url] of [['x', 'https://x.com/person'], ['linkedin', 'https://linkedin.com/in/person'], ['reddit', 'https://reddit.com/user/person']]) {
    expect(fs.readFileSync(`optional-plugins/bmux.${site}/follow.mjs`, 'utf8').replace(/^import .*\n/, '')).toBe(source)
    let result = await run(site, [url, `${url}/?ref=test`])
    expect(result.error).toBeUndefined()
    expect(result.calls.filter(call => call.method === 'navigate')).toHaveLength(1)
    expect(result.calls.findIndex(call => call.method === 'automation.follow')).toBeLessThan(result.calls.findIndex(call => call.method === 'cdp'))
    expect(result.calls.at(-1)).toEqual({ method: 'result', args: { followed: 1, reserved: 1, skipped: 0, capped: false } })
  }
})

test('capped, repeated and already-followed profiles never receive a click', async () => {
  for (let options of [{ cap: true }, { already: true }, { duplicate: true }]) {
    let result = await run('x', ['https://x.com/person'], options)
    expect(result.error).toBeUndefined()
    expect(result.calls.some(call => call.method === 'cdp')).toBe(false)
    expect(result.calls.at(-1)?.args).toMatchObject({ followed: 0, reserved: 0, capped: !!('cap' in options) })
  }
})

test('rejects non-profile URLs and off-site redirects before reserving a follow', async () => {
  for (let [site, url] of [['x', 'https://x.com/home'], ['x', 'https://x.com/person/status/1'], ['x', 'https://x.com.evil/person'], ['x', 'http://x.com/person'], ['x', 'https://user:pass@x.com/person'], ['linkedin', 'https://linkedin.com/feed'], ['reddit', 'https://reddit.com/r/bmux']]) {
    let result = await run(site, [url])
    expect(result.error).toBeDefined()
    expect(result.calls.some(call => call.method === 'automation.acquire')).toBe(false)
  }
  let result = await run('x', ['https://x.com/person'], { redirect: 'https://x.com/other' })
  expect(result.error).toContain('Could not find')
  expect(result.calls.some(call => call.method === 'automation.follow')).toBe(false)
})

test('unconfirmed follows stop the run and retain the reservation', async () => {
  let result = await run('x', ['https://x.com/person', 'https://x.com/other'], { confirm: false })
  expect(result.error).toContain('weekly attempt counted')
  expect(result.calls.filter(call => call.method === 'automation.follow')).toHaveLength(1)
  expect(result.calls.filter(call => call.method === 'navigate')).toHaveLength(1)
})

test('follow lookup uses only visible profile controls before X feed tabs', async () => {
  let result = await run('x', ['https://x.com/person'])
  let expression = result.calls.find(call => call.method === 'eval')!.args.expression
  let button = (id: string, beforeTabs: boolean, visible = true, article = false) => ({ getAttribute: (key: string) => key === 'data-testid' ? id : null, innerText: 'Follow', disabled: false, closest: () => article ? {} : null, compareDocumentPosition: () => beforeTabs ? 4 : 2, getBoundingClientRect: () => ({ x: 10, y: 10, width: visible ? 100 : 0, height: 30, left: 10, top: 10, right: 110, bottom: 40 }) })
  let buttons = [button('suggested-follow', false), button('post-follow', true, true, true)]
  let context = { document: { querySelector: () => ({ querySelector: () => ({}), querySelectorAll: () => buttons }) }, Node: { DOCUMENT_POSITION_FOLLOWING: 4 }, innerWidth: 800, innerHeight: 600 }
  expect(vm.runInNewContext(expression, context)).toBeNull()
  buttons.push(button('person-follow', true, false))
  expect(vm.runInNewContext(expression, context)).toBeNull()
  buttons.pop(); buttons.push(button('person-follow', true))
  expect(vm.runInNewContext(expression, context)).toEqual({ x: 60, y: 25 })
  buttons.pop(); buttons.push(button('person-unfollow', true))
  expect(vm.runInNewContext(expression, context)).toEqual({ following: true })
})
