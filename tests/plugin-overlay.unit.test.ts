import { expect, test } from 'vitest'
import { fitPluginOverlay, parsePluginOverlay, validatePluginOverlayInput } from '../src/shared/plugin-overlay'

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
  expect(fitPluginOverlay({ x: 900, y: 1000, width: 320, height: 500, collapsed: true }, area)).toEqual({ x: 610, y: 632, width: 320, height: 500, collapsed: true })
  expect(fitPluginOverlay(undefined, { x: 0, y: 0, width: 180, height: 150 })).toEqual({ x: 0, y: 0, width: 180, height: 150, collapsed: false })
})


test('full payload copies are separate from the compact overlay text limits', () => {
  let text = JSON.stringify({ image: 'x'.repeat(20000), caption: 'AI demo' })
  expect(parsePluginOverlay({ ...content, copies: [{ id: 'request', label: 'Copy sent payload', text }] }).copies?.[0].text).toBe(text)
  expect(() => parsePluginOverlay({ ...content, copies: [{ id: 'request', label: 'Copy', text: 'x'.repeat(300001) }] })).toThrow()
  expect(() => parsePluginOverlay({ ...content, copies: [{ id: 'request', label: 'Copy', text }, { id: 'request', label: 'Copy', text }] })).toThrow()
})
