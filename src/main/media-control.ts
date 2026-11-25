// Identify the device named by a trusted click in the isolated page world.
export let mediaControlSource = `(() => {
  if (window !== window.top || !window.isSecureContext || globalThis.__bmuxMediaControls) return;
  globalThis.__bmuxMediaControls = true;
  window.addEventListener('click', event => {
    if (!event.isTrusted || event.button !== 0) return;
    let control = event.composedPath().find(node => node instanceof Element &&
      node.matches('button, [role="button"], [role="menuitem"], input[type="button"]'));
    if (!control || control.matches(':disabled, [aria-disabled="true"]')) return;
    let labelledBy = control.getAttribute('aria-labelledby')?.split(/\\s+/).map(id => document.getElementById(id)?.textContent).join(' ');
    let label = (control.getAttribute('aria-label') || labelledBy || control.getAttribute('title') || control.value || control.textContent || '').trim().replace(/\\s+/g, ' ').toLowerCase();
    let match = /^(?:(?:allow(?: access to)?|enable|turn on|use|start(?: using)?|unmute|set up|test) (?:the |your )?)?(camera|microphone|mic)(?: *(?:and|&|\\/) *(?:the |your )?(camera|microphone|mic))?(?= *($|[(,]))/.exec(label);
    if (match) {
      let devices = [match[1], match[2]].filter(Boolean).map(device => device === 'camera' ? 'video' : 'audio');
      globalThis.bmuxMediaControl?.(JSON.stringify([location.origin, ...devices]));
    }
  }, { capture: true, passive: true });
})();`
