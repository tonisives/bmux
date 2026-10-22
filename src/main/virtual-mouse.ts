type Point = { x: number; y: number }
type Send = (method: string, params: Record<string, unknown>) => Promise<any>

let pointerScript = `(() => {
  let id = 'bmux-virtual-mouse';
  if (document.getElementById(id)) return;
  let pointer = document.createElement('div');
  pointer.id = id;
  pointer.setAttribute('aria-hidden', 'true');
  pointer.style.cssText = 'all:initial!important;position:fixed!important;left:0!important;top:0!important;width:24px!important;height:27px!important;pointer-events:none!important;z-index:2147483647!important;display:none!important;';
  let shadow = pointer.attachShadow({mode:'closed'});
  let pulse = document.createElement('span');
  pulse.style.cssText = 'position:absolute;left:0;top:0;width:27px;height:27px;border-radius:50%;background:#9cc7ff1f;box-shadow:0 0 0 1px #9cc7ff24;transform:translate(-50%,-50%);opacity:0;pointer-events:none;';
  let reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 36');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '27');
  svg.style.cssText = 'display:block;position:absolute;left:-2px;top:-2px;overflow:visible;filter:drop-shadow(0 1px 1px #0008);transform-origin:2px 2px;';
  let arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('d', 'M4 3.6Q2.2 2.3 2.6 4.5L7.6 27Q8 28.8 9.3 27.4L25 12.7Q26.5 11.4 24.5 10.8Z');
  arrow.setAttribute('fill', '#f7f9fc');
  arrow.setAttribute('stroke', '#252b35');
  arrow.setAttribute('stroke-width', '1.4');
  arrow.setAttribute('stroke-linejoin', 'round');
  svg.append(arrow);
  shadow.append(pulse, svg);
  document.documentElement.append(pointer);
  let rotation = svg.animate([{transform:'rotate(-3deg)'},{transform:'rotate(3deg)'},{transform:'rotate(-3deg)'}], {duration:3600,iterations:Infinity,easing:'ease-in-out'});
  let clickAnimation, idleTimer, visible = false;
  let updateMotion = () => {
    if (reducedMotion.matches || !visible) { rotation.cancel(); clickAnimation?.cancel(); }
    else rotation.play();
  };
  let hide = () => { visible = false; pointer.style.setProperty('display','none','important'); updateMotion(); };
  reducedMotion.addEventListener('change', updateMotion);
  updateMotion();
  pointer.addEventListener('bmux-agent-cursor', event => {
    let {x,y,hidden,click} = event.detail;
    clearTimeout(idleTimer);
    if (hidden) { hide(); return; }
    if (x !== undefined) pointer.style.setProperty('transform','translate('+x+'px,'+y+'px)','important');
    visible = true;
    pointer.style.setProperty('display','block','important');
    updateMotion();
    if (click && !reducedMotion.matches) {
      clickAnimation?.cancel();
      clickAnimation = pulse.animate([{transform:'translate(-50%,-50%) scale(.5)',opacity:1},{transform:'translate(-50%,-50%) scale(1.8)',opacity:0}], {duration:650,easing:'ease-out'});
    }
    idleTimer = setTimeout(hide,20000);
  });
})()`

export let createVirtualMouse = (sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), random = Math.random) => {
  let positions = new Map<string, Point>()
  let hiddenTabs = new Set<string>()
  let update = async (tab: string, send: Send, detail: Record<string, unknown> = {}) => {
    await send('Runtime.evaluate', { expression: `document.getElementById('bmux-virtual-mouse')?.dispatchEvent(new CustomEvent('bmux-agent-cursor',{detail:${JSON.stringify({ ...detail, hidden: hiddenTabs.has(tab) })}}))` })
  }
  let startPoint = async (tab: string, send: Send, validate: () => void) => {
    validate()
    let result = await send('Runtime.evaluate', { expression: '({width:innerWidth,height:innerHeight})', returnByValue: true })
    validate()
    let { width, height } = result.result.value
    let previous = positions.get(tab) ?? { x: width / 2, y: height / 2 }
    return { point: { x: Math.max(0, Math.min(width - 1, previous.x)), y: Math.max(0, Math.min(height - 1, previous.y)) }, width, height }
  }
  let show = async (tab: string, send: Send, validate: () => void) => {
    let { point } = await startPoint(tab, send, validate)
    await send('Runtime.evaluate', { expression: pointerScript })
    validate()
    await update(tab, send, point)
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
      await update(tab, send, { x, y })
      validate()
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
      positions.set(tab, { x, y })
      if (step < steps) { await sleep(waits[step]); elapsed += waits[step] }
    }
    validate()
  }
  let setHidden = async (tab: string, hidden: boolean, send: Send) => {
    if (hidden) hiddenTabs.add(tab); else hiddenTabs.delete(tab)
    if (hidden) await update(tab, send)
  }
  return { show, move, click: (tab: string, send: Send) => update(tab, send, { click: true }), setHidden, hiddenTabs,
    forget: (tab: string) => { positions.delete(tab); hiddenTabs.delete(tab) } }
}
