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
    let label = (control.getAttribute('aria-label') || labelledBy || control.getAttribute('title') || control.value || control.textContent || '').trim().toLowerCase();
    if (/\\b(turn off|disable|stop|mute)\\b/.test(label)) return;
    if (!/\\b(allow|enable|turn on|use|start|unmute|set up|test|check|retry)\\b/.test(label) && !/^(camera|microphone|mic)$/.test(label)) return;
    let devices = [];
    if (/\\bcamera\\b/.test(label)) devices.push('video');
    if (/\\b(microphone|mic)\\b/.test(label)) devices.push('audio');
    if (devices.length) globalThis.bmuxMediaControl?.(JSON.stringify([location.origin, ...devices]));
  }, { capture: true, passive: true });
})();`
