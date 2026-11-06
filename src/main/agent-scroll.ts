type Send = (method: string, params: Record<string, unknown>) => Promise<any>

export let smoothAgentScroll = async (send: Send, params: Record<string, unknown>) => {
  let deltaX = Number(params.deltaX ?? 0), deltaY = Number(params.deltaY ?? 0), x = Number(params.x), y = Number(params.y)
  if (![deltaX, deltaY, x, y].every(Number.isFinite)) throw new Error('Invalid scroll coordinates')
  if (!deltaX && !deltaY) return {}
  if (params.modifiers) return send('Input.dispatchMouseEvent', params)
  let motion = await send('Runtime.evaluate', { expression: "matchMedia('(prefers-reduced-motion: reduce)').matches", returnByValue: true })
  if (motion.result?.value) return send('Input.dispatchMouseEvent', { ...params, type: 'mouseWheel', deltaX, deltaY })
  let distance = Math.hypot(deltaX, deltaY)
  let duration = Math.min(1100, 280 + Math.sqrt(distance) * (15 + Math.random() * 7))
  let frames = Math.max(12, Math.round(duration / 20)), exponent = .9 + Math.random() * .4
  // One sine-shaped velocity envelope; small variations keep the peak and cadence individual.
  let weights = Array.from({ length: frames }, (_, index) => Math.pow(Math.sin(Math.PI * (index + .5) / frames), exponent) * (.94 + Math.random() * .12))
  let total = weights.reduce((sum, weight) => sum + weight, 0), traversed = 0, sentX = 0, sentY = 0, result
  for (let [index, weight] of weights.entries()) {
    traversed += weight
    let nextX = index === frames - 1 ? deltaX : Math.round(deltaX * traversed / total)
    let nextY = index === frames - 1 ? deltaY : Math.round(deltaY * traversed / total)
    if (nextX !== sentX || nextY !== sentY) result = await send('Input.dispatchMouseEvent', { ...params, type: 'mouseWheel', x, y, deltaX: nextX - sentX, deltaY: nextY - sentY })
    sentX = nextX; sentY = nextY
    // Space input after acknowledgement so a busy page never receives a catch-up burst.
    await new Promise(resolve => setTimeout(resolve, duration / frames * (.94 + Math.random() * .12)))
  }
  return result
}

export let agentScrollParams = (action: string, width: number, height: number, scrollY: number, scrollHeight: number) => {
  if (!['scroll-up', 'scroll-down', 'scroll-half-up', 'scroll-half-down', 'scroll-top', 'scroll-bottom'].includes(action)) throw new Error(`Unknown scroll action: ${action}`)
  let deltaY = action === 'scroll-top' ? -scrollY : action === 'scroll-bottom' ? Math.max(0, scrollHeight - height) - scrollY : (action.includes('half') ? Math.round(height / 2) : 100) * (action.endsWith('down') ? 1 : -1)
  return { x: Math.round(width / 2), y: Math.round(height / 2), deltaY, deltaX: 0 }
}
