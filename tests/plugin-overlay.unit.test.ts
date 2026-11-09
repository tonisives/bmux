import { expect, test } from 'vitest'
import { fitPluginOverlay, pluginOverlayHeight, conciseConfidence, pluginOverlaySummary, parsePluginOverlay, validatePluginOverlayInput } from '../src/shared/plugin-overlay'

let content = { title: 'Feed training', nodes: [{ title: 'Post', lines: ['A local fixture'], tone: 'cyan' }], controls: [{ id: 'ads', label: 'Skip ads', kind: 'toggle', value: false }, { id: 'mode', label: 'Mode', kind: 'choice', choices: ['Browse', 'Train'], value: 'Train' }] }
test('overlay accepts bounded text controls and rejects malformed input', () => {
  let parsed = parsePluginOverlay(content)
  expect(parsed.controls[0].value).toBe(false)
  expect(() => validatePluginOverlayInput(parsed.controls[0], true)).not.toThrow()
  expect(() => validatePluginOverlayInput(parsed.controls[0], 'true')).toThrow()
  expect(() => validatePluginOverlayInput(parsed.controls[1], 'Unknown')).toThrow()
  expect(() => validatePluginOverlayInput({ ...parsed.controls[0], disabled: true }, true)).toThrow()
  expect(() => parsePluginOverlay({ ...content, controls: [...content.controls, content.controls[0]] })).toThrow()
  expect(() => parsePluginOverlay({ ...content, title: 'x'.repeat(101) })).toThrow()
  expect(() => parsePluginOverlay({ ...content, nodes: Array(9).fill(content.nodes[0]) })).toThrow()
})
test('overlay stays inside its pane after resize, drag and collapse', () => {
  let area = { x: 30, y: 40, width: 900, height: 640 }
  expect(fitPluginOverlay({ x: -100, y: 1000, width: 2000, height: 900 }, area)).toEqual({ x: 30, y: 40, width: 900, height: 640, collapsed: false })
  expect(fitPluginOverlay({ x: 900, y: 1000, width: 320, height: 500, collapsed: true }, area)).toEqual({ x: 610, y: 648, width: 320, height: 500, collapsed: true })
  expect(fitPluginOverlay(undefined, { x: 0, y: 0, width: 180, height: 150 })).toEqual({ x: 0, y: 0, width: 180, height: 150, collapsed: false })
})


test('full payload copies are separate from the compact overlay text limits', () => {
  let text = JSON.stringify({ image: 'x'.repeat(20000), caption: 'AI demo' })
  expect(parsePluginOverlay({ ...content, copies: [{ id: 'request', label: 'Copy sent payload', text }] }).copies?.[0].text).toBe(text)
  expect(() => parsePluginOverlay({ ...content, copies: [{ id: 'request', label: 'Copy', text: 'x'.repeat(300001) }] })).toThrow()
  expect(() => parsePluginOverlay({ ...content, copies: [{ id: 'request', label: 'Copy', text }, { id: 'request', label: 'Copy', text }] })).toThrow()
})

test('settings buttons link only to an existing editable control', () => {
  let button = { id: 'configure', label: 'AI limit settings', kind: 'button', setting: 'mode' }
  expect(parsePluginOverlay({ ...content, controls: [...content.controls, button] }).controls.at(-1)?.setting).toBe('mode')
  expect(() => parsePluginOverlay({ ...content, controls: [button] })).toThrow('Unknown overlay setting')
  expect(() => parsePluginOverlay({ ...content, controls: [{ ...button, setting: 'configure' }] })).toThrow()
  expect(() => parsePluginOverlay({ ...content, controls: [{ ...content.controls[0], setting: 'mode' }] })).toThrow()
})


test('overlay errors bound diagnostic text and reference existing recovery buttons', () => {
  let controls = [...content.controls, { id: 'resume', label: 'Resume', kind: 'button' }]
  let error = { title: 'AI request failed', message: 'OpenAI rate limit reached', diagnostic: 'HTTP 429 · slow_down', controls: ['resume'] }
  expect(parsePluginOverlay({ ...content, controls, error }).error).toEqual(error)
  expect(() => parsePluginOverlay({ ...content, controls, error: { ...error, message: 'x'.repeat(1001) } })).toThrow()
  expect(() => parsePluginOverlay({ ...content, controls, error: { ...error, controls: ['missing'] } })).toThrow('Unknown overlay recovery control')
})

test('compact overlay uses a small native view and keeps its expanded size', () => {
  let bounds = fitPluginOverlay({ x: 100, y: 1000, width: 384, height: 500, compact: true }, { x: 0, y: 0, width: 900, height: 640 })
  expect(bounds).toMatchObject({ y: 576, height: 500, compact: true })
  expect(pluginOverlayHeight(bounds)).toBe(64)
  expect(pluginOverlayHeight({ ...bounds, compact: false })).toBe(500)
  expect(pluginOverlayHeight({ ...bounds, collapsed: true })).toBe(32)
})

test('AI confidence summaries omit duration explanations and keep the current action', () => {
  let parsed = parsePluginOverlay({ title: 'Feed', status: 'Browsing', nodes: [{ title: 'AI answer', tone: 'neutral', lines: ['Exact duration confidence: 72% (assessment text)', 'Profile match: 98%', 'Watching: 10s remaining'] }] })
  expect(conciseConfidence(parsed.nodes[0].lines[0])).toBe('Confidence: 72%')
  expect(pluginOverlaySummary(parsed)).toEqual({ decisions: 'Conf: 72% · Match: 98%', action: 'Watching: 10s remaining' })
  expect(pluginOverlaySummary({ ...parsed, status: 'Paused' }).action).toBe('Paused')
})

test('decision graph validates probabilities and active state', () => {
  let decision = { loading: false, options: [{ id: 'watch', label: 'Brief watch', probability: .8, active: true }] }
  expect(parsePluginOverlay({ ...content, decision }).decision).toEqual(decision)
  expect(() => parsePluginOverlay({ ...content, decision: { ...decision, options: [{ ...decision.options[0], probability: 2 }] } })).toThrow()
  expect(() => parsePluginOverlay({ ...content, decision: { ...decision, loading: 'yes' } })).toThrow()
})


test('overlay dimensions and collapsed height follow the page zoom', () => {
  let area = { x: 30, y: 40, width: 900, height: 640 }
  let full = fitPluginOverlay(undefined, area, .5)
  expect(full).toMatchObject({ width: 384, height: 600, x: 732, y: 46 })
  let collapsed = fitPluginOverlay({ ...full, x: 1000, y: 1000, collapsed: true }, area, .5)
  expect(collapsed).toMatchObject({ x: 738, y: 664, height: 600 })
  expect(pluginOverlayHeight(collapsed) * .5).toBe(16)
  let enlarged = fitPluginOverlay(undefined, area, 2)
  expect(enlarged.width * 2).toBeLessThanOrEqual(area.width)
  expect(enlarged.height * 2).toBeLessThanOrEqual(area.height)
})


test('plugins choose a bounded shared panel icon', () => {
  expect(parsePluginOverlay({ ...content, icon: 'search' }).icon).toBe('search')
  expect(parsePluginOverlay(content).icon).toBeUndefined()
  expect(() => parsePluginOverlay({ ...content, icon: '<svg onload=alert(1)>' })).toThrow('Invalid overlay icon')
})

test('resizing changes container dimensions at fixed zoom and anchors the opposite edges', async () => {
  let { resizePluginOverlay } = await import('../src/shared/plugin-overlay')
  let bounds = { x: 100, y: 200, width: 400, height: 600, collapsed: false }
  expect(resizePluginOverlay(bounds, 2, 'bottom-right', 80, 120)).toEqual({ ...bounds, width: 440, height: 660 })
  expect(resizePluginOverlay(bounds, 2, 'top-left', 80, 120)).toEqual({ ...bounds, x: 180, y: 320, width: 360, height: 540 })
  expect(resizePluginOverlay(bounds, 1, 'top-left', 1000, 1000)).toEqual({ ...bounds, x: 220, y: 560, width: 280, height: 240 })
})
