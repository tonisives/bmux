import { randomUUID } from 'node:crypto'

type Send = (method: string, params: Record<string, unknown>) => Promise<any>

export let readsPage = (method: string, args: Record<string, unknown> = {}) => ['dom', 'eval', 'forms.inspect'].includes(method) || method === 'cdp' && /^(Runtime\.(evaluate|callFunctionOn)|DOM\.(get|describe|query)|DOMSnapshot\.captureSnapshot|Accessibility\.get)/.test(String(args.method))

let readingScript = `(() => {
  let id = 'bmux-agent-reading', overlay = document.getElementById(id);
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.id = id;
  overlay.setAttribute('aria-hidden','true');
  overlay.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;display:none!important;';
  let svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;';
  let frames = Array.from({length:4},() => {
    let border = document.createElementNS(svg.namespaceURI,'rect'), wisp = document.createElementNS(svg.namespaceURI,'rect');
    for (let node of [border,wisp]) { node.setAttribute('fill','none'); node.setAttribute('rx','10'); node.setAttribute('pathLength','100'); }
    border.setAttribute('stroke','#79b7ff'); border.setAttribute('stroke-width','2');
    border.style.cssText = 'opacity:.8;filter:drop-shadow(0 0 5px #4096ff);';
    wisp.setAttribute('stroke','#e3f3ff'); wisp.setAttribute('stroke-width','4'); wisp.setAttribute('stroke-linecap','round'); wisp.setAttribute('stroke-dasharray','12 88');
    wisp.style.cssText = 'filter:drop-shadow(0 0 4px #64adff) drop-shadow(0 0 9px #64adff);';
    svg.append(border,wisp);
    return {border,wisp};
  });
  overlay.attachShadow({mode:'closed'}).append(svg);
  document.documentElement.append(overlay);
  let motion = matchMedia('(prefers-reduced-motion: reduce)'), animations = [], timer, layoutFrame, pending = new Set();
  let layout = () => {
    layoutFrame = undefined;
    let width = innerWidth, height = innerHeight;
    let regions = [...document.querySelectorAll('main,article,section,nav,form,aside,[role="main"],[role="dialog"],[role="region"]')].slice(0,160).map(node => node.getBoundingClientRect()).map(rect => ({x:Math.max(12,rect.left-5),y:Math.max(12,rect.top-5),right:Math.min(width-12,rect.right+5),bottom:Math.min(height-12,rect.bottom+5)})).filter(rect => rect.right-rect.x >= 180 && rect.bottom-rect.y >= 80 && (rect.right-rect.x)*(rect.bottom-rect.y) < width*height*.85).sort((a,b) => (b.right-b.x)*(b.bottom-b.y)-(a.right-a.x)*(a.bottom-a.y));
    let boxes = [{x:5,y:5,right:width-5,bottom:height-5}];
    for (let rect of regions) {
      if (boxes.some(box => Math.abs(box.x-rect.x)+Math.abs(box.y-rect.y)+Math.abs(box.right-rect.right)+Math.abs(box.bottom-rect.bottom)<60)) continue;
      boxes.push(rect);
      if (boxes.length === frames.length) break;
    }
    frames.forEach(({border,wisp},index) => {
      let box = boxes[index];
      for (let node of [border,wisp]) {
        node.style.display = box ? 'block' : 'none';
        if (box) for (let [key,value] of Object.entries({x:box.x,y:box.y,width:Math.max(0,box.right-box.x),height:Math.max(0,box.bottom-box.y)})) node.setAttribute(key,String(value));
      }
    });
    overlay.setAttribute('data-regions',String(boxes.length));
  };
  let scheduleLayout = () => { if (overlay.style.display !== 'none' && layoutFrame === undefined) layoutFrame = requestAnimationFrame(layout); };
  addEventListener('resize',scheduleLayout); addEventListener('scroll',scheduleLayout,true);
  let updateMotion = () => {
    animations.forEach(animation => animation.cancel()); animations = [];
    if (overlay.style.display === 'none') return;
    frames.forEach(({border,wisp},index) => {
      wisp.style.opacity = motion.matches ? '0' : '1';
      if (motion.matches) return;
      animations.push(border.animate([{opacity:.5},{opacity:1},{opacity:.5}],{duration:1200,iterations:Infinity,easing:'ease-in-out'}));
      animations.push(wisp.animate([{strokeDashoffset:100},{strokeDashoffset:0}],{duration:1800+index*240,iterations:Infinity,easing:'linear'}));
    });
  };
  motion.addEventListener('change',updateMotion);
  overlay[Symbol.for('bmux-agent-reading')] = ({id,active}) => {
    if (active) {
      clearTimeout(timer);
      pending.add(id);
      overlay.style.setProperty('display','block','important');
      layout();
      if (!animations.length) updateMotion();
    } else {
      if (!pending.delete(id)) return;
      if (!pending.size) timer = setTimeout(() => { overlay.style.setProperty('display','none','important'); updateMotion(); },2400);
    }
  };
})()`

// Visual feedback runs beside the command; page loading must never hold up a read.
export let withAgentReading = async <T>(send: Send, read: () => Promise<T>, current = () => true): Promise<T> => {
  let id = randomUUID()
  let update = (active: boolean) => active && !current() ? Promise.resolve() : send('Runtime.evaluate', { expression: `document.getElementById('bmux-agent-reading')?.[Symbol.for('bmux-agent-reading')](${JSON.stringify({ id, active })})` })
  let started = send('Runtime.evaluate', { expression: readingScript }).then(() => update(true)).catch(() => undefined)
  try { return await read() }
  finally { void started.then(() => update(false)).catch(() => undefined) }
}
