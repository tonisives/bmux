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
  let shade = document.createElement('div');
  shade.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:#9cc7ff0a;box-shadow:inset 0 0 36px #9cc7ff26;';
  overlay.attachShadow({mode:'closed'}).append(shade);
  document.documentElement.append(overlay);
  let motion = matchMedia('(prefers-reduced-motion: reduce)'), animation, timer, pending = new Set();
  let updateMotion = () => {
    animation?.cancel();
    animation = undefined;
    if (overlay.style.display === 'none') return;
    if (!motion.matches) animation = shade.animate([{opacity:.25},{opacity:1},{opacity:.25}],{duration:1200,iterations:Infinity,easing:'ease-in-out'});
  };
  motion.addEventListener('change',updateMotion);
  overlay.addEventListener('bmux-agent-reading',event => {
    let {id,active} = event.detail;
    if (active) {
      clearTimeout(timer);
      pending.add(id);
      overlay.style.setProperty('display','block','important');
      if (!animation) updateMotion();
    } else {
      if (!pending.delete(id)) return;
      if (!pending.size) timer = setTimeout(() => { overlay.style.setProperty('display','none','important'); updateMotion(); },2400);
    }
  });
})()`

// Visual feedback runs beside the command; page loading must never hold up a read.
export let withAgentReading = async <T>(send: Send, read: () => Promise<T>, current = () => true): Promise<T> => {
  let id = randomUUID()
  let update = (active: boolean) => active && !current() ? Promise.resolve() : send('Runtime.evaluate', { expression: `document.getElementById('bmux-agent-reading')?.dispatchEvent(new CustomEvent('bmux-agent-reading',{detail:${JSON.stringify({ id, active })}}))` })
  let started = send('Runtime.evaluate', { expression: readingScript }).then(() => update(true)).catch(() => undefined)
  try { return await read() }
  finally { void started.then(() => update(false)).catch(() => undefined) }
}
