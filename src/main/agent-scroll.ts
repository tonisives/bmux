import { DEFAULT_SCROLLING } from '../shared/scrolling'
import type { ScrollingSettings } from '../shared/scrolling'

type Send = (method: string, params: Record<string, unknown>) => Promise<any>

export let smoothAgentScroll = async (send: Send, params: Record<string, unknown>, settings: ScrollingSettings = DEFAULT_SCROLLING, inputScale = 1) => {
  let deltaX = Number(params.deltaX ?? 0), deltaY = Number(params.deltaY ?? 0), x = Number(params.x), y = Number(params.y)
  if (![deltaX, deltaY, x, y].every(Number.isFinite)) throw new Error('Invalid scroll coordinates')
  if (!deltaX && !deltaY) return {}
  let wheel = { ...params, type: 'mouseWheel', x: x * inputScale, y: y * inputScale, deltaX, deltaY }
  if (!settings.enabled || params.modifiers) return send('Input.dispatchMouseEvent', wheel)
  let motion = await send('Runtime.evaluate', { expression: `(() => {
    let room = (axis, delta) => {
      if (!delta) return null;
      let horizontal = axis === 'X', size = horizontal ? 'Width' : 'Height', offset = horizontal ? 'scrollLeft' : 'scrollTop';
      for (let node = document.elementFromPoint(${x}, ${y}); node; node = node.parentElement) {
        let overflow = getComputedStyle(node)[horizontal ? 'overflowX' : 'overflowY'];
        let max = node['scroll' + size] - node['client' + size];
        if (max > 0 && /^(auto|scroll|overlay)$/.test(overflow)) return delta > 0 ? max - node[offset] : node[offset];
      }
      let node = document.scrollingElement;
      return node ? (delta > 0 ? node['scroll' + size] - node['client' + size] - node[offset] : node[offset]) : 0;
    };
    return { reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, roomX: room('X', ${deltaX}), roomY: room('Y', ${deltaY}) };
  })()`, returnByValue: true })
  let state = motion.result?.value
  if (state === true || state?.reducedMotion) return send('Input.dispatchMouseEvent', wheel)
  let distance = Math.hypot(deltaX, deltaY)
  let vary = (minimum: number, maximum: number) => settings.randomize ? minimum + Math.random() * (maximum - minimum) : (minimum + maximum) / 2
  let duration = Math.min(1200, (280 + Math.sqrt(distance) * 18) * vary(.72, 1.28))
  let overshoot = settings.randomize && settings.overshoot && distance >= 80 && Math.random() < .3 ? Math.min(64, distance * vary(.04, .12)) / distance : 0
  // Leave enough room for the correction, including inside nested scroll containers.
  for (let [delta, room] of [[deltaX, state?.roomX], [deltaY, state?.roomY]]) {
    if (delta) overshoot = Math.min(overshoot, typeof room === 'number' ? Math.max(0, room / Math.abs(delta) - 1) : 0)
  }
  let sentX = 0, sentY = 0, result
  let move = async (targetX: number, targetY: number, milliseconds: number) => {
    let frames = Math.max(8, Math.round(milliseconds / 20)), exponent = vary(.9, 1.5)
    let weights = Array.from({ length: frames }, (_, index) => Math.pow(Math.sin(Math.PI * (index + .5) / frames), exponent) * vary(.94, 1.06))
    let total = weights.reduce((sum, weight) => sum + weight, 0), traversed = 0, startX = sentX, startY = sentY
    for (let [index, weight] of weights.entries()) {
      traversed += weight
      let nextX = index === frames - 1 ? targetX : startX + Math.round((targetX - startX) * traversed / total)
      let nextY = index === frames - 1 ? targetY : startY + Math.round((targetY - startY) * traversed / total)
      if (nextX !== sentX || nextY !== sentY) result = await send('Input.dispatchMouseEvent', { ...wheel, deltaX: nextX - sentX, deltaY: nextY - sentY })
      sentX = nextX; sentY = nextY
      // A busy page never receives a catch-up burst.
      await new Promise(resolve => setTimeout(resolve, milliseconds / frames * vary(.94, 1.06)))
    }
  }
  await move(deltaX + Math.round(deltaX * overshoot), deltaY + Math.round(deltaY * overshoot), duration)
  if (overshoot) {
    await new Promise(resolve => setTimeout(resolve, vary(40, 100)))
    await move(deltaX, deltaY, vary(140, 240))
  }
  return result
}

export let agentScrollParams = (action: string, width: number, height: number, scrollY: number, scrollHeight: number) => {
  if (!['scroll-up', 'scroll-down', 'scroll-half-up', 'scroll-half-down', 'scroll-top', 'scroll-bottom'].includes(action)) throw new Error(`Unknown scroll action: ${action}`)
  let deltaY = action === 'scroll-top' ? -scrollY : action === 'scroll-bottom' ? Math.max(0, scrollHeight - height) - scrollY : (action.includes('half') ? Math.round(height / 2) : 100) * (action.endsWith('down') ? 1 : -1)
  return { x: Math.round(width / 2), y: Math.round(height / 2), deltaY, deltaX: 0 }
}
