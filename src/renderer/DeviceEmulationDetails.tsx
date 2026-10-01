import { deviceSafeAreaInsets, deviceUserAgent, deviceUserAgentMetadata, deviceViewport } from '../shared/device-persona'
import type { DevicePersona } from '../shared/types'
import css from './DeviceEmulationDetails.module.css'

export let DeviceEmulationDetails = ({ device, active }: { device: DevicePersona; active: boolean }) => {
  let chromeVersion = navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '0.0.0.0'
  let viewport = deviceViewport(device), insets = deviceSafeAreaInsets(device)
  let userAgent = deviceUserAgent(device, chromeVersion), metadata = deviceUserAgentMetadata(device, chromeVersion)
  let clientHints = metadata ? {
    'Sec-CH-UA': metadata.brands.map(({ brand, version }) => `"${brand}";v="${version}"`).join(', '),
    'Sec-CH-UA-Mobile': '?1',
    'Sec-CH-UA-Platform': '"Android"',
  } : undefined
  let requestedHints = metadata ? {
    'Sec-CH-UA-Full-Version': `"${metadata.fullVersion}"`,
    'Sec-CH-UA-Full-Version-List': metadata.fullVersionList.map(({ brand, version }) => `"${brand}";v="${version}"`).join(', '),
    'Sec-CH-UA-Platform-Version': '"10.0.0"',
    'Sec-CH-UA-Arch': '""',
    'Sec-CH-UA-Model': '""',
    'Sec-CH-UA-Bitness': '""',
    'Sec-CH-UA-WoW64': '?0',
  } : undefined
  return <details className={css.details}>
    <summary>Emulation details</summary>
    {!active && <p>Applied when Mobile device is enabled.</p>}
    <dl>
      <div><dt>Viewport and screen</dt><dd>{viewport.width} × {viewport.height} CSS px · {device.orientation} · {viewport.angle}°</dd></div>
      <div><dt>Pixel ratio</dt><dd>{device.deviceScaleFactor}</dd></div>
      <div><dt>Touch input</dt><dd>Enabled · 5 touch points</dd></div>
      <div><dt>User-Agent header</dt><dd><code>{userAgent}</code></dd></div>
      <div><dt>Accept-Language header</dt><dd><code>{device.locale}</code></dd></div>
      <div><dt>Client hint headers</dt><dd><ClientHintHeaders headers={clientHints} /></dd></div>
      {requestedHints && <div><dt>Hints when requested</dt><dd><ClientHintHeaders headers={requestedHints} /></dd></div>}
      <div><dt>Navigator identity</dt><dd>{device.platform === 'ios' ? 'iPhone · Safari identity · no client hints' : 'Linux armv81 · Android Chrome identity · mobile userAgentData'}</dd></div>
      <div><dt>Locale</dt><dd>{device.locale}</dd></div>
      <div><dt>Timezone</dt><dd>{device.timezone}</dd></div>
      <div><dt>Geolocation</dt><dd>{device.geolocation ? `${device.geolocation.latitude}, ${device.geolocation.longitude} · accuracy ${device.geolocation.accuracy} m` : 'No override'}</dd></div>
      <div><dt>Hardware concurrency</dt><dd>{device.platform === 'ios' ? 6 : 8} cores</dd></div>
      <div><dt>Device memory</dt><dd>{device.platform === 'ios' ? 'Hidden' : '8 GB'}</dd></div>
      <div><dt>Safe areas</dt><dd>Top {insets.top} · right {insets.right} · bottom {insets.bottom} · left {insets.left} CSS px</dd></div>
      <div><dt>Page adjustments</dt><dd>Safe-area CSS values, page spacing, fixed and sticky bar offsets, status bar and home indicator tinted from the page</dd></div>
      <div><dt>Device frame</dt><dd>Rounded screen clipping and camera cutout · scaled to fit the pane</dd></div>
      <div><dt>Browser engine</dt><dd>Chromium {chromeVersion}</dd></div>
    </dl>
  </details>
}

let ClientHintHeaders = ({ headers }: { headers?: Record<string, string> }) => !headers ? <>Omitted for iOS</> : <>
  {Object.entries(headers).map(([name, value]) => <div key={name}><code>{name}: {value}</code></div>)}
</>
