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
    let update = () => {
      let cover = /viewport-fit\s*=\s*cover/i.test(document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '')
      // Edge-to-edge sites use the emulated env(safe-area-inset-*) themselves.
      spacing.textContent = cover ? '' : `html > body { ${Object.entries(insets).map(([edge, value]) => `padding-${edge}:calc(${padding[edge as keyof typeof padding]} + ${value}px)!important`).join(';')} }`
      let theme = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].find(meta => !meta.media || matchMedia(meta.media).matches)?.content
      let tint = theme && CSS.supports('color', theme) ? theme : [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).backgroundColor].find(color => color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') ?? '#fff'
      host.style.setProperty('--tint', tint)
      // Resolve named, hex and modern CSS colors before choosing readable symbols.
      if (context) { context.clearRect(0, 0, 1, 1); context.fillStyle = tint; context.fillRect(0, 0, 1, 1) }
      let rgb = context?.getImageData(0, 0, 1, 1).data ?? [255, 255, 255]
      host.style.setProperty('--ink', rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 < 150 ? '#fff' : '#111')
    }
    document.documentElement.append(spacing, host)
    update()
    let scheduled = false
    let schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; update() }) } }
    let observer = new MutationObserver(schedule)
    if (document.head) observer.observe(document.head, { subtree: true, childList: true, attributes: true, characterData: true })
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule)
    window.addEventListener('pageshow', schedule)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
}

export let deviceSafeAreaScript = (device: DevicePersona) => `(${installSafeAreas.toString()})(${JSON.stringify(deviceSafeAreaInsets(device))})`
