import type { DevicePersona } from '../shared/types'

export let deviceSafeAreaInsets = (device: DevicePersona) => {
  let top = device.platform === 'ios' ? 59 : 40
  return device.orientation === 'portrait'
    ? { top, bottom: device.platform === 'ios' ? 34 : 24, left: 0, right: 0 }
    : { top: 0, bottom: device.platform === 'ios' ? 21 : 24, left: top, right: top }
}

// Runs in an isolated, unprivileged world. The native camera remains above this UI.
let installSafeAreas = (insets: ReturnType<typeof deviceSafeAreaInsets>) => {
  if (window !== window.top) return
  let mount = () => {
    if (!document.body || document.querySelector('bmux-device-bars')) return
    let host = document.createElement('bmux-device-bars')
    host.setAttribute('aria-hidden', 'true')
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;display:block!important'
    let shadow = host.attachShadow({ mode: 'open' })
    let style = document.createElement('style')
    style.textContent = `
      :host { --tint: #fff; --ink: #111; }
      .bar { position:absolute; background:color-mix(in srgb,var(--tint) 92%,transparent); backdrop-filter:blur(16px); color:var(--ink); font:600 14px -apple-system,sans-serif; box-sizing:border-box; }
      .top { top:0; left:0; right:0; height:${insets.top}px; display:${insets.top ? 'flex' : 'none'}; align-items:center; justify-content:space-between; padding:0 28px; }
      .bottom { bottom:0; left:0; right:0; height:${insets.bottom}px; }
      .home { position:absolute; bottom:8px; left:50%; transform:translateX(-50%); width:32%; max-width:140px; height:5px; border-radius:5px; background:var(--ink); }
      .left { left:0; top:0; bottom:0; width:${insets.left}px; }
      .right { right:0; top:0; bottom:0; width:${insets.right}px; }
      svg { width:54px; height:14px; fill:currentColor; }
    `
    let top = document.createElement('div'); top.className = 'bar top'
    top.innerHTML = '<span>9:41</span><svg viewBox="0 0 54 14" aria-hidden="true"><path d="M0 10h3v4H0zm5-3h3v7H5zm5-3h3v10h-3zm5-3h3v13h-3z"/><rect x="27" y="2" width="23" height="11" rx="3" fill="none" stroke="currentColor"/><rect x="29" y="4" width="19" height="7" rx="1"/><path d="M52 5h2v5h-2z"/></svg>'
    let bottom = document.createElement('div'); bottom.className = 'bar bottom'
    let home = document.createElement('div'); home.className = 'home'; bottom.append(home)
    let left = document.createElement('div'); left.className = 'bar left'
    let right = document.createElement('div'); right.className = 'bar right'
    shadow.append(style, top, bottom, left, right)
    let spacing = document.createElement('style')
    let original = getComputedStyle(document.body)
    let padding = { top: original.paddingTop, bottom: original.paddingBottom, left: original.paddingLeft, right: original.paddingRight }
    let swatch = document.createElement('canvas'); swatch.width = 1; swatch.height = 1
    let context = swatch.getContext('2d', { willReadFrequently: true })
    let set = (element: HTMLElement, property: string, value: string, priority = '') => {
      if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== priority) element.style.setProperty(property, value, priority)
    }
    let surface = (y: number) => {
      for (let element of document.elementsFromPoint(innerWidth / 2, y)) {
        if (element === host || element.getBoundingClientRect().width < innerWidth * 0.7) continue
        let color = getComputedStyle(element).backgroundColor
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color
      }
    }
    let tintBar = (bar: HTMLElement, tint: string) => {
      set(bar, '--tint', tint)
      if (context) { context.clearRect(0, 0, 1, 1); context.fillStyle = tint; context.fillRect(0, 0, 1, 1) }
      let rgb = context?.getImageData(0, 0, 1, 1).data ?? [255, 255, 255]
      set(bar, '--ink', rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 < 150 ? '#fff' : '#111')
    }
    let discover = true, positioned: HTMLElement[] = []
    let update = () => {
      let cover = /viewport-fit\s*=\s*cover/i.test(document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '')
      // A cover declaration alone does not mean the site actually adds safe-area padding.
      let css = `html > body { ${Object.entries(insets).map(([edge, value]) => {
        let existing = padding[edge as keyof typeof padding]
        let extra = cover ? Math.max(0, value - parseFloat(existing)) : value
        return `padding-${edge}:calc(${existing} + ${extra}px)!important`
      }).join(';')} }`
      if (spacing.textContent !== css) spacing.textContent = css
      // Fixed headers ignore body padding; sticky headers also need a safe sticking point.
      // Check geometry so sites already using env(safe-area-inset-*) aren't inset twice.
      if (discover) {
        discover = false
        positioned = [...document.body.querySelectorAll<HTMLElement>('*')].filter(element => ['fixed', 'sticky'].includes(getComputedStyle(element).position))
      }
      for (let element of positioned) {
        let computed = getComputedStyle(element)
        if (computed.position !== 'fixed' && computed.position !== 'sticky') continue
        let rect = element.getBoundingClientRect()
        if (!rect.width || !rect.height) continue
        for (let edge of ['top', 'bottom'] as const) {
          let offset = parseFloat(computed[edge]), inset = insets[edge]
          if (!Number.isFinite(offset) || !inset) continue
          let visibleGap = edge === 'top' ? rect.top : innerHeight - rect.bottom
          let gap = computed.position === 'sticky' ? Math.max(offset, visibleGap) : visibleGap
          if (gap >= -1 && gap < inset - 1) set(element, edge, `${computed.position === 'sticky' ? inset : offset + inset - gap}px`, 'important')
        }
      }
      let theme = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].find(meta => !meta.media || matchMedia(meta.media).matches)?.content
      let fallback = theme && CSS.supports('color', theme) ? theme : '#fff'
      // Match the painted surface at each edge, including app roots and fixed navigation.
      let upper = surface(insets.top + 2) ?? fallback
      let lower = surface(innerHeight - insets.bottom - 2) ?? fallback
      tintBar(top, upper); tintBar(bottom, lower); tintBar(left, upper); tintBar(right, upper)
    }
    document.documentElement.append(spacing, host)
    update()
    let scheduled = false
    let schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; update() }) } }
    let observer = new MutationObserver(() => { discover = true; schedule() })
    if (document.head) observer.observe(document.head, { subtree: true, childList: true, attributes: true, characterData: true })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule)
    window.addEventListener('pageshow', schedule)
    window.addEventListener('resize', () => { discover = true; schedule() })
    document.addEventListener('scroll', schedule, { passive: true, capture: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
}

export let deviceSafeAreaScript = (device: DevicePersona) => `(${installSafeAreas.toString()})(${JSON.stringify(deviceSafeAreaInsets(device))})`
