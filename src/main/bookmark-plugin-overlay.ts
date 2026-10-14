import type { BookmarkPluginAttachment, BookmarkPluginContribution } from '../shared/plugins'

type Entry = { attachment: BookmarkPluginAttachment; name: string; contribution?: BookmarkPluginContribution; error?: string }
// Executed only in the bookmark isolated world. The binding can update this
// bookmark's validated settings; it exposes no general browser or Node API.
export let mountBookmarkPluginOverlay = (entries: Entry[], send: (value: string) => void) => {
  let host = document.createElement('div')
  host.setAttribute('data-bmux-bookmark-plugins', '')
  host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;display:block'
  let shadow = host.attachShadow({ mode: 'closed' })
  ;(globalThis as any).__bmuxBookmarkOverlay = shadow
  let sheet = new CSSStyleSheet()
  sheet.replaceSync(':host{color-scheme:dark}section{font:12px/1.4 system-ui;color:#eee;background:#222;border:1px solid #555;padding:8px;max-width:270px;max-height:65vh;overflow:auto}label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:5px 0}input,select,button{font:inherit;color:inherit;background:#333;border:1px solid #666;padding:3px}input[type=number]{width:65px}input[type=text]{width:120px}summary{cursor:pointer}p{margin:5px 0;color:#bbb}input[type=range]{width:100%}')
  shadow.adoptedStyleSheets = [sheet]
  let section = document.createElement('section')
  section.setAttribute('aria-label', 'Bookmark plugins')
  for (let entry of entries) {
    let values = Object.fromEntries(entry.contribution?.controls.map(control => [control.name, entry.attachment.values[control.name] ?? control.default]) ?? Object.entries(entry.attachment.values)), enabled = entry.attachment.enabled
    let save = () => send(JSON.stringify({ id: entry.attachment.id, enabled, values }))
    let label = document.createElement('label'), toggle = document.createElement('input')
    toggle.type = 'checkbox'; toggle.checked = enabled; toggle.disabled = !entry.contribution || !!entry.error
    toggle.setAttribute('aria-label', `Enable ${entry.name}`)
    toggle.addEventListener('change', () => { enabled = toggle.checked; save() })
    label.append(document.createTextNode(entry.name), toggle); section.append(label)
    if (entry.error) { let message = document.createElement('p'); message.textContent = entry.error; section.append(message) }
    if (!entry.contribution) continue
    let expanded = ((globalThis as any).__bmuxBookmarkExpanded ??= {})
    let details = document.createElement('details'), summary = document.createElement('summary')
    summary.textContent = 'Configure'; details.open = expanded[entry.attachment.id] === true; details.addEventListener('toggle', () => { expanded[entry.attachment.id] = details.open }); details.append(summary)
    for (let control of entry.contribution.controls) {
      let label = document.createElement('label'), input = control.kind === 'choice' ? document.createElement('select') : document.createElement('input')
      input.setAttribute('aria-label', control.title)
      if (input instanceof HTMLSelectElement) for (let choice of control.choices ?? []) { let option = document.createElement('option'); option.value = choice; option.textContent = choice; input.append(option) }
      else {
        input.type = control.kind === 'boolean' ? 'checkbox' : control.kind === 'number' ? 'number' : 'text'
        if (control.kind === 'number') { if (control.min !== undefined) input.min = String(control.min); if (control.max !== undefined) input.max = String(control.max); input.step = String(control.step ?? 'any') }
        if (control.kind === 'boolean') input.checked = values[control.name] === true
      }
      input.value = String(values[control.name] ?? control.default)
      input.addEventListener('change', () => {
        if (!input.checkValidity()) { input.reportValidity(); return }
        values[control.name] = control.kind === 'boolean' ? (input as HTMLInputElement).checked : control.kind === 'number' ? Number(input.value) : input.value
        save()
      })
      label.append(document.createTextNode(control.title), input); details.append(label)
    }
    section.append(details)
  }
  shadow.append(section); document.documentElement.append(host)
  return () => { host.remove(); delete (globalThis as any).__bmuxBookmarkOverlay }
}
