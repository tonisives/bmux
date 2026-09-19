import type { WebContents } from 'electron'
import type { FrameContext } from './frame-cosmetics'
import { generateHints, usableHintCharacters } from '../shared/click-mode'
import type { ClickAction, ClickModeSettings, DoubleTapInput } from '../shared/click-mode'

type ScanResult = { index: number; x: number; y: number; width: number; height: number; role: string; title: string; url: string | null }
type Candidate = ScanResult & { frame: FrameContext; hint: string }
type ActiveMode = { clientId: string; tabId: string; contents: WebContents; contexts: FrameContext[]; candidates: Candidate[]; input: string; action: ClickAction; wrongSecondKey: boolean; settings: ClickModeSettings; version: number }
type Options = {
  frames: (tabId: string, expression: string) => Promise<FrameContext[]>
  valid: (clientId: string, tabId: string, contents: WebContents) => boolean
  openLink: (clientId: string, tabId: string, url: string, action: Extract<ClickAction, 'float' | 'split-left' | 'split-right'>) => Promise<void>
  error: (error: unknown) => void
}

let linkAction = (action: ClickAction): action is Extract<ClickAction, 'float' | 'split-left' | 'split-right'> => action === 'float' || action === 'split-left' || action === 'split-right'

let installClickMode = (token: string) => {
  type Hint = { index: number; hint: string; x: number; y: number }
  type Style = { showInput: boolean; main: boolean; fontSize: number; opacity: number; backgroundColor: string; textColor: string }
  let scope = globalThis as typeof globalThis & { __bmuxClickMode?: { token: string; elements: Element[]; host: HTMLElement; shadow: ShadowRoot; render: (hints: Hint[], input: string, action: string, style: Style, shake: boolean) => void; remove: () => void } }
  scope.__bmuxClickMode?.remove()
  let selector = 'a[href],button,input:not([type="hidden"]),textarea,select,label,summary,details,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="radio"],[role="textbox"],[role="combobox"],[role="option"],[role="switch"],[onclick],[tabindex]:not([tabindex="-1"]),[contenteditable]:not([contenteditable="false"])'
  let roots: (Document | ShadowRoot)[] = [document]
  for (let cursor = 0; cursor < roots.length; cursor++) for (let element of roots[cursor].querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot)
  let seen = new Set<Element>(), positions = new Set<string>(), elements: Element[] = [], results: ScanResult[] = []
  for (let root of roots) for (let element of root.querySelectorAll(selector)) {
    if (results.length >= 500 || seen.has(element)) continue
    seen.add(element)
    if (!(element instanceof HTMLElement || element instanceof SVGElement) || (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) && element.disabled || element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('hidden')) continue
    let style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || style.pointerEvents === 'none') continue
    let bounds = element.getBoundingClientRect()
    let left = Math.max(0, bounds.left), top = Math.max(0, bounds.top), right = Math.min(innerWidth, bounds.right), bottom = Math.min(innerHeight, bounds.bottom)
    if (right <= left || bottom <= top) continue
    let position = `${Math.round(left)},${Math.round(top)}`
    if (positions.has(position)) continue
    positions.add(position)
    let title = element.getAttribute('aria-label') || element.getAttribute('title') || (element as HTMLInputElement).value || (element as HTMLInputElement).placeholder || element.textContent || ''
    elements.push(element)
    let rawUrl = element.tagName.toLowerCase() === 'a' ? element.getAttribute('href') : null, url: string | null = null
    if (rawUrl) try { let parsed = new URL(rawUrl, document.baseURI); if (['http:', 'https:', 'file:'].includes(parsed.protocol)) url = parsed.href } catch { /* Ignore malformed links. */ }
    results.push({ index: elements.length - 1, x: left, y: top, width: right - left, height: bottom - top, role: element.getAttribute('role') || element.tagName.toLowerCase(), title: title.trim().replace(/\s+/g, ' ').slice(0, 80), url })
  }
  let host = document.createElement('div')
  host.dataset.bmuxClickMode = token
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden;display:block;'
  let shadow = host.attachShadow({ mode: 'closed' })
  let remove = () => host.remove()
  let render = (hints: Hint[], input: string, action: string, settings: Style, shake: boolean) => {
    shadow.replaceChildren()
    let style = document.createElement('style')
    style.textContent = '@keyframes bmux-click-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(4px)}50%{transform:translateX(-4px)}75%{transform:translateX(3px)}}'
    shadow.append(style)
    for (let item of hints) {
      if (input && !item.hint.startsWith(input)) continue
      let label = document.createElement('span'), matched = item.hint.slice(0, input.length), remaining = item.hint.slice(input.length)
      label.style.cssText = `all:initial;position:fixed;left:${item.x + 2}px;top:${item.y + 2}px;background:${settings.backgroundColor};color:${settings.textColor};font:700 ${settings.fontSize}px/1.25 ui-monospace,SFMono-Regular,Menlo,monospace;padding:1px 4px;border:1px solid rgba(0,0,0,.2);border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,.4);opacity:${settings.opacity};letter-spacing:.5px;white-space:nowrap;${shake ? 'animation:bmux-click-shake .25s linear;' : ''}`
      if (matched) { let prefix = document.createElement('span'); prefix.textContent = matched; prefix.style.opacity = '.4'; label.append(prefix) }
      label.append(document.createTextNode(remaining)); shadow.append(label)
    }
    if (settings.showInput && settings.main) {
      let definitions = [
        { action: 'normal', key: 'n', label: 'click', icon: '<path d="M4 3v16l4.2-4.1 3 6.6 3-1.4-3-6.5H17z"/>' },
        { action: 'right', key: 'r', label: 'right', icon: '<rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 2v8h7"/><path d="M13 3h1a4 4 0 0 1 4 4v2h-5z" fill="currentColor" stroke="none" opacity=".35"/>' },
        { action: 'command', key: 'c', label: 'cmd', icon: '<text x="12" y="17" text-anchor="middle" font-size="17" stroke="none" fill="currentColor">⌘</text>' },
        { action: 'double', key: 'd', label: 'double', icon: '<text x="12" y="16" text-anchor="middle" font-size="13" font-weight="700" stroke="none" fill="currentColor">2×</text>' },
        { action: 'float', key: 'f', label: 'float', icon: '<rect x="3" y="6" width="13" height="12" rx="1"/><rect x="8" y="3" width="13" height="12" rx="1" fill="currentColor" fill-opacity=".18"/>' },
        { action: 'split-left', key: 'h', label: 'left', icon: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16"/><path d="M4 5h7v14H4z" fill="currentColor" stroke="none" opacity=".3"/>' },
        { action: 'split-right', key: 'l', label: 'right', icon: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16"/><path d="M13 5h7v14h-7z" fill="currentColor" stroke="none" opacity=".3"/>' },
      ]
      let indicator = document.createElement('span')
      indicator.style.cssText = `all:initial;position:fixed;left:50%;top:12px;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;gap:3px;max-width:calc(100vw - 24px);background:rgba(20,22,25,.94);color:#f4f5f6;font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:5px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.35);white-space:nowrap;opacity:${settings.opacity}`
      if (input) {
        let typed = document.createElement('span')
        typed.textContent = input
        typed.style.cssText = `all:initial;color:${settings.backgroundColor};font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:0 5px`
        indicator.append(typed)
      }
      for (let [index, definition] of definitions.entries()) {
        if (index === 4) { let divider = document.createElement('span'); divider.style.cssText = 'all:initial;width:1px;height:18px;background:rgba(255,255,255,.24);margin:0 2px'; indicator.append(divider) }
        let item = document.createElement('span'), icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), key = document.createElement('span')
        let selected = action === definition.action
        item.dataset.bmuxClickAction = definition.action; item.dataset.selected = String(selected)
        item.style.cssText = `all:initial;display:inline-flex;align-items:center;gap:3px;color:${selected ? settings.textColor : '#f4f5f6'};background:${selected ? settings.backgroundColor : 'transparent'};font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 5px;border:1px solid ${selected ? settings.backgroundColor : 'rgba(255,255,255,.2)'};border-radius:3px`
        icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true'); icon.style.cssText = 'width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round'
        icon.innerHTML = definition.icon
        key.textContent = definition.key
        key.style.cssText = `all:initial;color:${selected ? settings.textColor : settings.backgroundColor};font:700 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace`
        item.append(key, icon, document.createTextNode(definition.label)); indicator.append(item)
      }
      shadow.append(indicator)
      host.dataset.bmuxClickIcons = String(indicator.querySelectorAll('svg').length)
      host.dataset.bmuxClickSelected = action
    }
  }
  document.documentElement.append(host)
  scope.__bmuxClickMode = { token, elements, host, shadow, render, remove }
  return results
}

let clickModeCall = (method: 'render' | 'remove', parameters: unknown[] = []) => `(() => { let mode = globalThis.__bmuxClickMode; if (!mode) return false; mode.${method}(...${JSON.stringify(parameters)}); return true })()`
let sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))

export let createClickMode = (options: Options) => {
  let active: ActiveMode | undefined, version = 0
  let clear = (mode: ActiveMode) => Promise.allSettled(mode.contexts.map(context => context.evaluate(clickModeCall('remove'))))
  let cancel = () => { version++; let previous = active; active = undefined; return previous ? clear(previous) : Promise.resolve([]) }
  let render = (mode: ActiveMode, shake = false) => {
    let visible = linkAction(mode.action) ? mode.candidates.filter(candidate => candidate.url) : mode.candidates
    for (let context of mode.contexts) {
      let style = { showInput: mode.settings.showInput, main: !context.parentId, fontSize: mode.settings.fontSize, opacity: mode.settings.opacity, backgroundColor: mode.settings.backgroundColor, textColor: mode.settings.textColor }
      let hints = visible.filter(candidate => candidate.frame === context).map(({ index, hint, x, y }) => ({ index, hint, x, y }))
      void context.evaluate(clickModeCall('render', [hints, mode.input, mode.action, style, shake])).catch(() => undefined)
    }
  }
  let activate = async (clientId: string, tabId: string, contents: WebContents, settings: ClickModeSettings) => {
    cancel()
    if (!settings.enabled || contents.isDestroyed()) return false
    let activation = version, token = `${Date.now()}-${activation}`
    active = { clientId, tabId, contents, contexts: [], candidates: [], input: '', action: 'normal', wrongSecondKey: false, settings, version: activation }
    try {
      let contexts = await options.frames(tabId, `(${installClickMode.toString()})(${JSON.stringify(token)})`)
      if (!active || active.version !== activation || !options.valid(clientId, tabId, contents)) { for (let context of contexts) void context.evaluate(clickModeCall('remove')).catch(() => undefined); return false }
      let scanned = contexts.flatMap(frame => Array.isArray(frame.value) ? (frame.value as ScanResult[]).map(result => ({ ...result, frame })) : []).slice(0, 500)
      let hints = generateHints(scanned.length, usableHintCharacters(settings.hintCharacters))
      active.contexts = contexts
      active.candidates = scanned.map((candidate, index) => ({ ...candidate, hint: hints[index] }))
      if (!active.candidates.length) { cancel(); return false }
      render(active)
      return true
    } catch (error) { if (active?.version === activation) cancel(); options.error(error); return false }
  }
  let sendClick = async (mode: ActiveMode, candidate: Candidate) => {
    let action = mode.action, contents = mode.contents, clientId = mode.clientId, tabId = mode.tabId
    await cancel(); await sleep(50)
    if (!options.valid(clientId, tabId, contents) || contents.isDestroyed()) return
    if (linkAction(action)) { if (candidate.url) await options.openLink(clientId, tabId, candidate.url, action); return }
    let point = await candidate.frame.point(candidate.x + candidate.width / 2, candidate.y + candidate.height / 2)
    let x = Math.round(point.x), y = Math.round(point.y), modifiers = action === 'command' ? 4 : 0
    contents.focus()
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers })
    let click = async (button: 'left' | 'right', clickCount: number) => {
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'left' ? 1 : 2, clickCount, modifiers })
      await sleep(10)
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount, modifiers })
    }
    if (action === 'double') { await click('left', 1); await sleep(50); await click('left', 2) }
    else await click(action === 'right' ? 'right' : 'left', 1)
  }
  let handle = (clientId: string, input: DoubleTapInput) => {
    let mode = active
    if (!mode || mode.clientId !== clientId) return false
    if (input.type !== 'keyDown') return true
    if (input.key === 'Escape') { cancel(); return true }
    if (input.key === 'Backspace') { mode.input = mode.input.slice(0, -1); mode.wrongSecondKey = false; render(mode); return true }
    let key = input.key.toLowerCase()
    let actions: Record<string, ClickAction> = { r: 'right', c: 'command', d: 'double', n: 'normal', f: 'float', h: 'split-left', l: 'split-right' }
    let action = !input.alt && !input.control && !input.meta && !input.shift ? actions[key] : undefined
    if (action) { mode.action = action; mode.input = ''; mode.wrongSecondKey = false; render(mode); return true }
    if (input.alt || input.control || input.meta || input.shift || input.key.length !== 1 || !/[a-z\d]/i.test(input.key)) return true
    let next = mode.input + key.toUpperCase()
    let available = linkAction(mode.action) ? mode.candidates.filter(candidate => candidate.url) : mode.candidates
    let matches = available.filter(candidate => candidate.hint.startsWith(next))
    let exact = matches.find(candidate => candidate.hint === next)
    if (exact) { void sendClick(mode, exact).catch(options.error); return true }
    if (matches.length) { mode.input = next; mode.wrongSecondKey = false; render(mode); return true }
    if (mode.input.length === 1 && !mode.wrongSecondKey) { mode.wrongSecondKey = true; render(mode, true); return true }
    cancel(); return true
  }
  return { activate, cancel, handle, active: () => !!active, cancelTab: (tabId: string) => { if (active?.tabId === tabId) cancel() }, cancelClient: (clientId: string) => { if (active?.clientId === clientId) cancel() } }
}
