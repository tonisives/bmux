type Point = { x: number; y: number }
type Send = (method: string, params: Record<string, unknown>) => Promise<any>

let pointerScript = `(() => {
  let id = 'bmux-virtual-mouse';
  if (document.getElementById(id)) return;
  let pointer = document.createElement('div');
  pointer.id = id;
  pointer.setAttribute('aria-hidden', 'true');
  pointer.style.cssText = 'all:initial!important;position:fixed!important;left:0!important;top:0!important;width:22px!important;height:30px!important;pointer-events:none!important;z-index:2147483647!important;display:none!important;';
  let shadow = pointer.attachShadow({mode:'closed'});
  let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 22 30');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '30');
  svg.style.cssText = 'display:block;overflow:visible;filter:drop-shadow(0 1px 1px rgb(0 0 0 / .3));';
  let arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('d', 'M2 1.5C1.8 1.34 1.5 1.48 1.5 1.75V23C1.5 23.45 2.05 23.66 2.36 23.35L7.2 18.45L11.15 27.05C11.32 27.42 11.75 27.58 12.12 27.41L15.02 26.05C15.4 25.88 15.55 25.44 15.38 25.07L11.4 16.5H18.9C19.36 16.5 19.56 15.93 19.2 15.64Z');
  arrow.setAttribute('fill', '#202124');
  arrow.setAttribute('stroke', '#f8fafc');
  arrow.setAttribute('stroke-width', '1.25');
  arrow.setAttribute('stroke-linejoin', 'round');
  svg.append(arrow);
  shadow.append(svg);
  document.documentElement.append(pointer);
})()`

export let createVirtualMouse = (sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), random = Math.random) => {
  let positions = new Map<string, Point>()
  let startPoint = async (tab: string, send: Send, validate: () => void) => {
    validate()
    let result = await send('Runtime.evaluate', { expression: '({width:innerWidth,height:innerHeight})', returnByValue: true })
    validate()
    let { width, height } = result.result.value
    let previous = positions.get(tab) ?? { x: width / 2, y: height / 2 }
    return { point: { x: Math.max(0, Math.min(width - 1, previous.x)), y: Math.max(0, Math.min(height - 1, previous.y)) }, width, height }
  }
  let draw = async (point: Point, send: Send) => {
    await send('Runtime.evaluate', { expression: `(() => { let p=document.getElementById('bmux-virtual-mouse'); if(p){p.style.setProperty('transform','translate(${point.x}px,${point.y}px)','important');p.style.setProperty('display','block','important');} })()` })
  }
  let show = async (tab: string, send: Send, validate: () => void) => {
    let { point } = await startPoint(tab, send, validate)
    await send('Runtime.evaluate', { expression: pointerScript })
    validate()
    await draw(point, send)
    validate()
    positions.set(tab, point)
  }
  let move = async (tab: string, target: Record<string, unknown>, send: Send, validate: () => void) => {
    let end = { x: Number(target.x), y: Number(target.y) }
    if (!Number.isFinite(end.x) || !Number.isFinite(end.y)) throw new Error('Invalid mouse coordinates')
    let { point: start, width, height } = await startPoint(tab, send, validate)
    let dx = end.x - start.x, dy = end.y - start.y, distance = Math.hypot(dx, dy)
    if (distance < .01) { await show(tab, send, validate); return }
    let normal = { x: -dy / distance, y: dx / distance }
    let bend = Math.min(70, distance / 4) * (random() < .5 ? -1 : 1)
    let middle = { x: (start.x + end.x) / 2 + normal.x * bend, y: (start.y + end.y) / 2 + normal.y * bend }
    if (middle.x < 0 || middle.x >= width || middle.y < 0 || middle.y >= height) bend = -bend
    let firstBend = bend * (.5 + random() * .5), secondBend = bend * (random() - .35)
    let first = { x: start.x + dx * .3 + normal.x * firstBend, y: start.y + dy * .3 + normal.y * firstBend }
    let second = { x: start.x + dx * .75 + normal.x * secondBend, y: start.y + dy * .75 + normal.y * secondBend }
    let jitter = Math.min(4, distance / 100), phase = random() * Math.PI * 2, waves = 1 + random() * 2
    let steps = Math.max(20, Math.min(38, Math.ceil(distance / 24)))
    let waits = Array.from({ length: steps }, () => 12 + Math.round(random() * 12))
    let duration = waits.reduce((total, wait) => total + wait, 0), elapsed = 0
    await send('Runtime.evaluate', { expression: pointerScript })
    for (let step = 0; step <= steps; step++) {
      validate()
      let progress = elapsed / duration, t = progress ** 3 * (10 - 15 * progress + 6 * progress ** 2)
      let wobble = Math.sin(Math.PI * t) ** 2 * Math.sin(phase + t * Math.PI * 2 * waves) * jitter
      let x = step === steps ? end.x : Math.max(0, Math.min(width - 1, (1 - t) ** 3 * start.x + 3 * (1 - t) ** 2 * t * first.x + 3 * (1 - t) * t ** 2 * second.x + t ** 3 * end.x + normal.x * wobble))
      let y = step === steps ? end.y : Math.max(0, Math.min(height - 1, (1 - t) ** 3 * start.y + 3 * (1 - t) ** 2 * t * first.y + 3 * (1 - t) * t ** 2 * second.y + t ** 3 * end.y + normal.y * wobble))
      await draw({ x, y }, send)
      validate()
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
      positions.set(tab, { x, y })
      if (step < steps) { await sleep(waits[step]); elapsed += waits[step] }
    }
    validate()
  }
  let pauseAfterClick = () => sleep(800 + random() * 400)
  return { show, move, pauseAfterClick, forget: (tab: string) => positions.delete(tab) }
}
