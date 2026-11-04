import type { BookmarkHiddenPost, BookmarkPluginAttachment, BookmarkPluginContribution } from '../shared/plugins'

type Entry = { attachment: BookmarkPluginAttachment; name: string; contribution?: BookmarkPluginContribution; error?: string }
// Executed only in the bookmark isolated world. The binding can update this
// bookmark's validated settings; it exposes no general browser or Node API.
export let mountBookmarkPluginOverlay = (entries: Entry[], send: (value: string) => void, reports = new Map<string, BookmarkHiddenPost[]>()) => {
  let host = document.createElement('div')
  host.setAttribute('data-bmux-bookmark-plugins', '')
  host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;display:block'
  let shadow = host.attachShadow({ mode: 'closed' })
  ;(globalThis as any).__bmuxBookmarkOverlay = shadow
  let sheet = new CSSStyleSheet()
  sheet.replaceSync(':host{color-scheme:dark}section{font:14px/20px Geist,system-ui;color:#eee;background:#181818;border:1px solid #555;border-radius:8px;max-width:min(320px,calc(100vw - 24px));max-height:65vh;overflow:auto}summary{cursor:pointer;padding:8px 12px;font-weight:600;user-select:none}summary:hover{background:#272727}summary:active{background:#313131}summary:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid #aaa;outline-offset:2px}.content{padding:0 12px 12px}label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0}input,select{font:inherit;color:inherit;background:#272727;border:1px solid #666;padding:4px;max-width:100%;box-sizing:border-box}input[type=number]{width:64px}input[type=text]{width:120px}.settings>summary{padding:4px 0;font-weight:400}p{margin:8px 0;color:#bbb;text-wrap:pretty}ol{list-style:none;padding:0;margin:8px 0}li{padding:8px 0;overflow-wrap:anywhere}a{color:#eee;text-decoration:underline}a:hover{color:#fff}small{display:block;font-size:12px;line-height:16px;color:#bbb;margin-top:4px}h2{font:inherit;font-weight:600;margin:12px 0 4px}input[type=range]{width:100%}')
  shadow.adoptedStyleSheets = [sheet]
  let section = document.createElement('section')
  section.setAttribute('aria-label', 'Bookmark plugins')
  let overview = document.createElement('details'), count = document.createElement('summary'), content = document.createElement('div'), matches = document.createElement('div')
  overview.setAttribute('data-hidden-overview', '')
  count.setAttribute('aria-label', 'Hidden posts')
  overview.open = (globalThis as any).__bmuxBookmarkOverviewOpen === true
  content.className = 'content'
  overview.append(count, content); section.append(overview)
  for (let entry of entries) {
    let values = Object.fromEntries(entry.contribution?.controls.map(control => [control.name, entry.attachment.values[control.name] ?? control.default]) ?? Object.entries(entry.attachment.values)), enabled = entry.attachment.enabled
    let save = () => send(JSON.stringify({ id: entry.attachment.id, enabled, values }))
    let label = document.createElement('label'), toggle = document.createElement('input')
    toggle.type = 'checkbox'; toggle.checked = enabled; toggle.disabled = !entry.contribution || !!entry.error
    toggle.setAttribute('aria-label', `Enable ${entry.name}`)
    toggle.addEventListener('change', () => { enabled = toggle.checked; save() })
    label.append(document.createTextNode(entry.name), toggle); content.append(label)
    if (entry.error) { let message = document.createElement('p'); message.textContent = entry.error; content.append(message) }
    if (!entry.contribution) continue
    let expanded = ((globalThis as any).__bmuxBookmarkExpanded ??= {})
    let details = document.createElement('details'), summary = document.createElement('summary')
    details.className = 'settings'
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
    content.append(details)
  }
  content.append(matches)
  let previous = ''
  let update = () => {
    let total = entries.reduce((total, entry) => total + (reports.get(entry.attachment.id)?.length ?? 0), 0)
    count.textContent = entries.some(entry => entry.error) ? `${total} hidden · Filter unavailable` : `${total} hidden${entries.every(entry => !entry.attachment.enabled) ? ' · Off' : ''}`
    count.title = 'Posts hidden on this search page. Expand to review matches and settings.'
    if (!overview.open) return
    let snapshot = JSON.stringify(entries.map(entry => reports.get(entry.attachment.id) ?? []))
    if (snapshot === previous) return
    previous = snapshot; matches.replaceChildren()
    if (!total) {
      let empty = document.createElement('p'); empty.textContent = 'No posts hidden on this page.'; matches.append(empty)
    }
    for (let entry of entries) {
      let posts = reports.get(entry.attachment.id) ?? []
      if (!posts.length) continue
      let heading = document.createElement('h2'); heading.textContent = `${entry.name}: ${posts.length}`; matches.append(heading)
      let list = document.createElement('ol'); list.setAttribute('aria-label', `Posts hidden by ${entry.name}`)
      for (let post of posts) {
        let item = document.createElement('li'), title = document.createElement('span'), reason = document.createElement('small')
        title.textContent = post.title
        if (/^https?:\/\//i.test(post.url)) {
          let link = document.createElement('a'); link.href = post.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.append(title); item.append(link)
        } else item.append(title)
        reason.textContent = post.reasons.join(' · '); item.append(reason); list.append(item)
      }
      matches.append(list)
    }
  }
  overview.addEventListener('toggle', () => { (globalThis as any).__bmuxBookmarkOverviewOpen = overview.open; update() })
  update()
  shadow.append(section); document.documentElement.append(host)
  return Object.assign(() => { host.remove(); delete (globalThis as any).__bmuxBookmarkOverlay }, { update })
}
