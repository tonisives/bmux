type Send = (method: string, params: Record<string, unknown>) => Promise<any>

export let smoothAgentScroll = async (send: Send, params: Record<string, unknown>) => {
  let deltaX = Number(params.deltaX ?? 0), deltaY = Number(params.deltaY ?? 0), x = Number(params.x), y = Number(params.y)
  if (![deltaX, deltaY, x, y].every(Number.isFinite)) throw new Error('Invalid scroll coordinates')
  if (!deltaX && !deltaY) return {}
  if (params.modifiers) return send('Input.dispatchMouseEvent', params)
  let motion = await send('Runtime.evaluate', { expression: "matchMedia('(prefers-reduced-motion: reduce)').matches", returnByValue: true })
  return send('Input.synthesizeScrollGesture', { x, y, xDistance: -deltaX, yDistance: -deltaY, gestureSourceType: 'mouse', preventFling: true, speed: motion.result?.value ? 10_000_000 : Math.max(200, Math.round(Math.hypot(deltaX, deltaY) / .45)) })
}

export let agentScrollParams = (action: string, width: number, height: number, scrollY: number, scrollHeight: number) => {
  if (!['scroll-up', 'scroll-down', 'scroll-half-up', 'scroll-half-down', 'scroll-top', 'scroll-bottom'].includes(action)) throw new Error(`Unknown scroll action: ${action}`)
  let deltaY = action === 'scroll-top' ? -scrollY : action === 'scroll-bottom' ? Math.max(0, scrollHeight - height) - scrollY : (action.includes('half') ? Math.round(height / 2) : 100) * (action.endsWith('down') ? 1 : -1)
  return { x: Math.round(width / 2), y: Math.round(height / 2), deltaY, deltaX: 0 }
}
