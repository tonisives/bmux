let duration = (value: unknown, name: string, allowZero = false) => {
  let numeric = typeof value === 'number' || (typeof value === 'string' && !!value.trim())
  let number = Number(value)
  if (!numeric || !Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) throw new Error(`Wait ${name} must be a ${allowZero ? 'non-negative' : 'positive'} number`)
  return number
}

export let waitOptions = (args: Record<string, unknown>) => {
  let timeout = Math.min(duration(args.timeout === undefined ? 15000 : args.timeout, 'timeout'), 60000)
  let modes = ['selector', 'expression', 'ms'].filter(key => args[key] !== undefined)
  if (modes.length !== 1) throw new Error('Provide exactly one of selector, expression, or ms')
  if (args.state !== undefined && modes[0] !== 'selector') throw new Error('Wait state requires a selector')
  if (modes[0] === 'ms') {
    let ms = duration(args.ms, 'ms', true)
    return { timeout, ms: Math.min(ms, timeout) }
  }
  if (modes[0] === 'expression') {
    if (typeof args.expression !== 'string' || !args.expression.trim()) throw new Error('Wait expression must not be empty')
    return { timeout, expression: args.expression }
  }
  if (typeof args.selector !== 'string' || !args.selector.trim()) throw new Error('Wait selector must not be empty')
  let state = args.state === undefined ? 'attached' : args.state
  if (typeof state !== 'string' || !['attached', 'detached', 'visible', 'hidden'].includes(state)) throw new Error('Wait state must be attached, detached, visible, or hidden')
  let expression = `(() => {
    let element = document.querySelector(${JSON.stringify(args.selector)})
    let state = ${JSON.stringify(state)}
    if (state === 'attached') return !!element
    if (state === 'detached') return !element
    let visible = false
    if (element) {
      let style = getComputedStyle(element), bounds = element.getBoundingClientRect()
      visible = style.visibility !== 'hidden' && style.visibility !== 'collapse' && bounds.width > 0 && bounds.height > 0
    }
    return state === 'visible' ? visible : !visible
  })()`
  return { timeout, expression }
}
