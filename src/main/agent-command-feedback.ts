export let AGENT_COMMAND_FEEDBACK_MS = 5000

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
  let commands = [], timer, root = document.getElementById('agent-commands');
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
  globalThis.showAgentCommands = value => { commands = value; render(); };
})()`
