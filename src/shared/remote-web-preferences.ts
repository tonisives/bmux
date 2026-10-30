// Chromium 152 can deliver a stale connecting state after a remote channel opens
// when transferable channels defer observer registration. BMUX keeps its remote
// channels in their original renderer, so register their observers synchronously.
export let remoteWebPreferences = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  backgroundThrottling: false,
  disableBlinkFeatures: 'TransferableRTCDataChannel',
}
