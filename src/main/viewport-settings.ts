export type ViewportSettings = { width: number; height: number; zoom: number }

// Runs only in the browser-owned stationary control.
export let observeViewportSettings = (marker: string, settings: ViewportSettings, open: boolean) => {
  let scope = globalThis as typeof globalThis & { bmuxViewportSettings?: (settings: ViewportSettings, open: boolean) => void }
  if (scope.bmuxViewportSettings) { scope.bmuxViewportSettings(settings, open); return }
  let root = document.querySelector('#bmux-viewport-pan')!.shadowRoot!
  let sheet = new CSSStyleSheet()
  sheet.replaceSync(`
    button[aria-label="Pan viewport"] { right:40px !important }
    .settings { right:0;top:0;visibility:hidden;pointer-events:none }
    :host(:hover) { pointer-events:auto !important }
    :host(:hover) .settings,:host(:focus-within) .settings,.settings[aria-expanded="true"] { visibility:visible;pointer-events:auto }
    form { position:absolute;box-sizing:border-box;top:40px;right:0;width:288px;padding:16px;border:1px solid #666;border-radius:8px;background:#272727;color:white;font:14px/20px system-ui;pointer-events:auto }
    form[hidden] { display:none }
    form div { position:static;inset:auto;pointer-events:auto;cursor:auto }
    label { display:block;margin-bottom:12px }
    .dimensions { display:flex;gap:8px }
    .dimensions label { min-width:0;flex:1 }
    input,select { box-sizing:border-box;width:100%;margin-top:4px;padding:4px 8px;border:1px solid #666;border-radius:4px;background:#181818;color:white;font:inherit }
    input:focus-visible,select:focus-visible { outline:2px solid white;outline-offset:2px }
    form button { position:static;width:auto;height:32px;padding:4px 12px;font:inherit }
    .actions { display:flex;justify-content:flex-end;gap:8px }
  `)
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
  let gear = document.createElement('button')
  gear.type = 'button'; gear.className = 'settings'; gear.setAttribute('aria-label', 'Viewport settings'); gear.setAttribute('aria-expanded', 'false'); gear.title = 'Viewport settings'
  gear.innerHTML = '<svg viewBox="0 0 256 256" aria-hidden="true" style="stroke-width:16"><path d="m102 40 8-24h36l8 24 24 14 25-5 18 31-17 19v28l17 19-18 31-25-5-24 14-8 24h-36l-8-24-24-14-25 5-18-31 17-19V99L35 80l18-31 25 5Z"/><circle cx="128" cy="113" r="32"/></svg>'
  let form = document.createElement('form')
  form.setAttribute('aria-label', 'Viewport settings')
  form.innerHTML = `<label>Preset<select aria-label="Viewport preset"><option value="custom">Custom</option><option value="1512x982">MacBook Pro 14″ · 1512 × 982</option><option value="1440x900">Laptop · 1440 × 900</option><option value="1920x1080">Desktop · 1920 × 1080</option></select></label><div class="dimensions"><label>Width<input name="width" type="number" min="1" max="16384" required></label><label>Height<input name="height" type="number" min="1" max="16384" required></label></div><label>Zoom (%)<input name="zoom" type="number" min="25" max="300" step="any" required></label><div class="actions"><button type="button">Cancel</button><button type="submit">Apply</button></div>`
  root.append(gear, form)
  let width = form.elements.namedItem('width') as HTMLInputElement, height = form.elements.namedItem('height') as HTMLInputElement, zoom = form.elements.namedItem('zoom') as HTMLInputElement
  let preset = form.querySelector('select')!
  let report = console.debug.bind(console), shown = false
  let update = (next: ViewportSettings, expanded: boolean) => {
    // Preserve edits during unrelated page state refreshes.
    if (!shown || !expanded) {
      width.value = String(next.width); height.value = String(next.height); zoom.value = String(Math.round(next.zoom * 10000) / 100)
      let value = `${next.width}x${next.height}`
      preset.value = [...preset.options].some(option => option.value === value) ? value : 'custom'
    }
    shown = expanded; form.hidden = !expanded
    gear.setAttribute('aria-expanded', String(expanded))
  }
  scope.bmuxViewportSettings = update
  gear.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); report(marker + JSON.stringify({ open: !shown })) })
  form.querySelector('button')!.addEventListener('click', () => report(marker + JSON.stringify({ open: false })))
  preset.addEventListener('change', () => {
    if (preset.value === 'custom') return
    let [w, h] = preset.value.split('x'); width.value = w; height.value = h; zoom.value = '100'
  })
  for (let input of [width, height]) input.addEventListener('input', () => { preset.value = 'custom' })
  form.addEventListener('submit', event => {
    event.preventDefault(); event.stopPropagation()
    if (form.reportValidity()) report(marker + JSON.stringify({ width: width.valueAsNumber, height: height.valueAsNumber, zoom: zoom.valueAsNumber / 100 }))
  })
  window.addEventListener('keydown', event => {
    if (shown && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); report(marker + JSON.stringify({ open: false })) }
  }, true)
  window.addEventListener('blur', () => { if (shown) report(marker + JSON.stringify({ open: false })) })
  update(settings, open)
}
