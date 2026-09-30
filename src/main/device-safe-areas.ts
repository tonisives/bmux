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
    let time = document.createElement('span'); time.textContent = '9:41'
    let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 54 14'); svg.setAttribute('aria-hidden', 'true')
    for (let [tag, attributes] of [
      ['path', { d: 'M0 10h3v4H0zm5-3h3v7H5zm5-3h3v10h-3zm5-3h3v13h-3z' }],
      ['rect', { x: '27', y: '2', width: '23', height: '11', rx: '3', fill: 'none', stroke: 'currentColor' }],
      ['rect', { x: '29', y: '4', width: '19', height: '7', rx: '1' }],
      ['path', { d: 'M52 5h2v5h-2z' }],
    ] as [string, Record<string, string>][]) {
      let shape = document.createElementNS(svg.namespaceURI, tag)
      for (let [name, value] of Object.entries(attributes)) shape.setAttribute(name, value)
      svg.append(shape)
    }
    top.append(time, svg)
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
        if (element === host || element.matches('input,select,textarea,button') || element.getBoundingClientRect().width < innerWidth * 0.7) continue
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
    type Edge = 'top' | 'bottom'
    type Offset = { value: string; priority: string; applied: string; original: number }
    let adjusted = new Map<HTMLElement, Partial<Record<Edge, Offset>>>()
    let discover = true, positioned: HTMLElement[] = []
    let observer: MutationObserver
    let observe = () => observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'content', 'media'], characterData: true })
    let restore = () => {
      for (let [element, edges] of adjusted) for (let edge of ['top', 'bottom'] as const) {
        let previous = edges[edge]
        if (previous && element.style.getPropertyValue(edge) === previous.applied && element.style.getPropertyPriority(edge) === 'important') {
          if (previous.value) element.style.setProperty(edge, previous.value, previous.priority)
          else element.style.removeProperty(edge)
        }
      }
      adjusted.clear()
    }
    let navigationSurface = (edge: Edge) => {
      for (let element of positioned) {
        let rect = element.getBoundingClientRect(), computed = getComputedStyle(element)
        let offset = adjusted.get(element)?.[edge]?.original ?? parseFloat(computed[edge])
        if (rect.width < innerWidth * 0.7 || rect.height > innerHeight / 3 || !rect.height || !Number.isFinite(offset) || offset < 0 || offset > 128) continue
        if (edge === 'top' ? rect.top > insets.top + 128 || rect.bottom < 0 : rect.bottom < innerHeight - insets.bottom - 128 || rect.top > innerHeight) continue
        let color = computed.backgroundColor
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color
      }
    }
    let update = () => {
      observer?.disconnect()
      if (!host.isConnected) document.documentElement.append(host)
      if (!spacing.isConnected) document.head.append(spacing)
      let cover = /viewport-fit\s*=\s*cover/i.test(document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '')
      // A cover declaration alone does not mean the site actually adds safe-area padding.
      let css = `html > body { ${Object.entries(insets).map(([edge, value]) => {
        let existing = padding[edge as keyof typeof padding]
        let extra = cover ? Math.max(0, value - parseFloat(existing)) : value
        return `padding-${edge}:calc(${existing} + ${extra}px)!important`
      }).join(';')} }`
      if (spacing.textContent !== css) spacing.textContent = css
      // Recompute authored offsets on DOM/style changes, never from an animated screen position.
      if (discover) {
        discover = false
        restore()
        positioned = [...document.body.querySelectorAll<HTMLElement>('*')].filter(element => ['fixed', 'sticky'].includes(getComputedStyle(element).position))
        for (let element of [...positioned].sort((a, b) => (parseFloat(getComputedStyle(a).top) || 0) - (parseFloat(getComputedStyle(b).top) || 0))) {
          let computed = getComputedStyle(element), rect = element.getBoundingClientRect()
          if (!rect.width || !rect.height) continue
          // Transformed blocks move their fixed descendants; inset bars move sticky descendants.
          let contained = false
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            let style = getComputedStyle(parent)
            if (computed.position === 'sticky' && adjusted.has(parent) || computed.position === 'fixed' && (style.transform !== 'none' || style.filter !== 'none' || style.perspective !== 'none' || /paint|layout|strict|content/.test(style.contain))) { contained = true; break }
          }
          if (contained) continue
          for (let edge of ['top', 'bottom'] as const) {
            let offset = parseFloat(computed[edge]), inset = insets[edge]
            let safePadding = parseFloat(edge === 'top' ? computed.paddingTop : computed.paddingBottom)
            let stacked = [...adjusted].some(([other, edges]) => edges[edge] && Math.abs(offset - edges[edge]!.original - other.getBoundingClientRect().height) < 1)
            if (!inset || !Number.isFinite(offset) || offset < 0 || offset >= inset - 1 && !stacked || safePadding >= inset) continue
            let applied = `${offset + inset}px`
            let edges = adjusted.get(element) ?? {}
            edges[edge] = { value: element.style.getPropertyValue(edge), priority: element.style.getPropertyPriority(edge), applied, original: offset }
            adjusted.set(element, edges)
            set(element, edge, applied, 'important')
          }
        }
      }
      let theme = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].find(meta => !meta.media || matchMedia(meta.media).matches)?.content
      let fallback = theme && CSS.supports('color', theme) ? theme : '#fff'
      // Match the painted surface at each edge, including app roots and fixed navigation.
      let upper = navigationSurface('top') ?? surface(insets.top + 2) ?? fallback
      let lower = navigationSurface('bottom') ?? surface(innerHeight - insets.bottom - 2) ?? fallback
      tintBar(top, upper); tintBar(bottom, lower); tintBar(left, upper); tintBar(right, upper)
      if (observer) observe()
    }
    document.head.append(spacing)
    document.documentElement.append(host)
    update()
    let scheduled = false
    let schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; update() }) } }
    observer = new MutationObserver(() => { discover = true; schedule() })
    observe()
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule)
    window.addEventListener('pageshow', schedule)
    window.addEventListener('resize', () => { discover = true; schedule() })
    document.addEventListener('scroll', schedule, { passive: true, capture: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
}

export let deviceSafeAreaScript = (device: DevicePersona) => `(${installSafeAreas.toString()})(${JSON.stringify(deviceSafeAreaInsets(device))})`
