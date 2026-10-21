type Point = { x: number; y: number }
type Send = (method: string, params: Record<string, unknown>) => Promise<any>

let pointerScript = `(() => {
  let id = 'bmux-virtual-mouse';
  document.getElementById(id)?.remove();
  let pointer = document.createElement('div');
  pointer.id = id;
  pointer.setAttribute('aria-hidden', 'true');
  pointer.style.cssText = 'all:initial!important;position:fixed!important;left:0!important;top:0!important;width:22px!important;height:30px!important;pointer-events:none!important;z-index:2147483647!important;display:none!important;';
  let shadow = pointer.attachShadow({mode:'closed'});
  let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 22 30');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '30');
  let arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('d', 'M1 1L1 23L7 18L12 28L17 25L12 16L21 16Z');
  arrow.setAttribute('fill', 'white');
  arrow.setAttribute('stroke', '#171b20');
  arrow.setAttribute('stroke-width', '2');
  arrow.setAttribute('stroke-linejoin', 'round');
  svg.append(arrow);
  shadow.append(svg);
  document.documentElement.append(pointer);
})()`

export let createVirtualMouse = (sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) => {
  let positions = new Map<string, Point>()
  let move = async (tab: string, target: Record<string, unknown>, send: Send, validate: () => void) => {
    let end = { x: Number(target.x), y: Number(target.y) }
    if (!Number.isFinite(end.x) || !Number.isFinite(end.y)) throw new Error('Invalid mouse coordinates')
    validate()
    let result = await send('Runtime.evaluate', { expression: '({width:innerWidth,height:innerHeight})', returnByValue: true })
    let { width, height } = result.result.value
    let previous = positions.get(tab) ?? { x: width / 2, y: height / 2 }
    let start = { x: Math.max(0, Math.min(width - 1, previous.x)), y: Math.max(0, Math.min(height - 1, previous.y)) }
    let bend = Math.min(70, Math.hypot(end.x - start.x, end.y - start.y) / 4)
    let control = { x: (start.x + end.x) / 2, y: Math.max(0, Math.min(height - 1, (start.y + end.y) / 2 - bend)) }
    await send('Runtime.evaluate', { expression: pointerScript })
    for (let step = 0; step <= 20; step++) {
      validate()
      let progress = step / 20, t = progress * progress * (3 - 2 * progress)
      let x = (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x
      let y = (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y
      await send('Runtime.evaluate', { expression: `(() => { let p=document.getElementById('bmux-virtual-mouse'); if(p){p.style.setProperty('transform','translate(${x}px,${y}px)','important');p.style.setProperty('display','block','important');} })()` })
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
      positions.set(tab, { x, y })
      if (step < 20) await sleep(16)
    }
    validate()
  }
  return { move, forget: (tab: string) => positions.delete(tab) }
}
