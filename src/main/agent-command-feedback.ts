import { DEFAULT_AGENT_FEEDBACK } from '../shared/agent-feedback'

export let AGENT_COMMAND_FEEDBACK_MS = DEFAULT_AGENT_FEEDBACK.commandDisplayMs

export let agentCommandLabel = (method: string, args: Record<string, unknown> = {}): string => {
  let point = (params: Record<string, unknown>) => Number.isFinite(params.x) && Number.isFinite(params.y) ? ` (${Math.round(Number(params.x))}, ${Math.round(Number(params.y))})` : ''
  if (method === 'cdp') {
    let params = (args.params ?? {}) as Record<string, unknown>
    if (args.method === 'Input.dispatchMouseEvent') {
      if (params.type === 'mouseWheel') {
        let x = Number(params.deltaX) || 0, y = Number(params.deltaY) || 0, horizontal = Math.abs(x) > Math.abs(y), delta = horizontal ? x : y
        return `scroll ${horizontal ? delta < 0 ? 'left' : 'right' : delta < 0 ? 'up' : 'down'} ${Math.round(Math.abs(delta))} px`
      }
      return `${params.type === 'mouseMoved' ? 'move pointer' : 'click'}${point(params)}`
    }
    if (args.method === 'Input.insertText') return 'type text'
    if (args.method === 'Input.dispatchKeyEvent') return 'key'
    if (/^Runtime\.(evaluate|callFunctionOn)$/.test(String(args.method))) return 'eval'
    return /^[A-Za-z]+\.[A-Za-z]+$/.test(String(args.method)) ? `cdp ${args.method}` : 'cdp'
  }
  if (method === 'click') return `click${point(args)}`
  if (method === 'type') return 'type text'
  if (method === 'fill') return 'fill fields'
  if (method === 'scroll') return ['scroll-up', 'scroll-down', 'scroll-half-up', 'scroll-half-down', 'scroll-top', 'scroll-bottom'].includes(String(args.action)) ? String(args.action).replaceAll('-', ' ') : 'scroll'
  if (method === 'navigate') {
    try { let url = new URL(String(args.url)); return /^https?:$/.test(url.protocol) ? `navigate ${url.hostname}` : 'navigate' } catch { return 'navigate' }
  }
  return ['wait', 'dom', 'eval', 'key', 'screenshot', 'back', 'forward', 'reload', 'hard-reload', 'history.go-to', 'forms.inspect', 'forms.fill'].includes(method) ? method : 'command'
}

export let agentCommandFeedbackScript = `(() => {
  let id = 'bmux-agent-commands';
  if (document.getElementById(id)) return;
  let host = document.createElement('div'); host.id = id;
  host.style.cssText = 'all:initial!important;position:fixed!important;bottom:12px!important;left:12px!important;right:12px!important;pointer-events:none!important;z-index:2147483647!important;';
  let shadow = host.attachShadow({mode:'closed'}), style = document.createElement('style'), root = document.createElement('div');
  style.textContent = ':host{pointer-events:none}.commands{display:flex;flex-direction:column;align-items:flex-start;gap:4px;color:#edf1f5;font:12px ui-monospace,SFMono-Regular,monospace}.commands div{box-sizing:border-box;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 9px;background:#171b20eb;border:1px solid #424852}';
  root.className = 'commands'; root.setAttribute('role','log'); root.setAttribute('aria-label','Agent commands');
  shadow.append(style,root); document.documentElement.append(host);
  let commands = [], timer;
  let render = () => {
    clearTimeout(timer);
    commands = commands.filter(command => command.expiresAt > Date.now()).slice(-3);
    root.replaceChildren(...commands.map(command => {
      let line = document.createElement('div');
      line.textContent = command.text;
      return line;
    }));
    if (commands.length) timer = setTimeout(render, Math.max(1, Math.min(...commands.map(command => command.expiresAt)) - Date.now()));
  };
  host.addEventListener('bmux-agent-commands', event => { commands = event.detail; render(); });
})()`
