import { DEVICE_PRESETS } from '../../src/shared/device-persona'
import type { FingerprintProfile } from '../../src/shared/fingerprint'
import type { DevicePersona, DevicePreset, ProfileProxy } from '../../src/shared/types'
import css from './FingerprintFields.module.css'

export type FingerprintSection = 'device' | 'connection' | 'viewport'
let desktopDevice: DevicePersona = { preset:'pixel-8', ...DEVICE_PRESETS['pixel-8'], orientation:'portrait', locale:'en-US', timezone:'UTC' }
let defaultProxy: ProfileProxy = { protocol:'http', host:'', port:8080, authenticated:false }

export let FingerprintFields = ({ section, value, change }: { section: FingerprintSection; value: FingerprintProfile; change: (value: FingerprintProfile) => void }) => {
  let { device, proxy, viewport } = value
  let updateDevice = (patch: Partial<DevicePersona>) => { if (device) change({ ...value,device:{ ...device,...patch } }) }
  let updateProxy = (patch: Partial<ProfileProxy>) => { if (proxy) change({ ...value,proxy:{ ...proxy,...patch } }) }
  if (section === 'viewport') return <div className={css.fields}>
    <label className={css.toggle}><input type="checkbox" checked={!!viewport} onChange={event => change({ ...value, viewport:event.target.checked ? { width:1280,height:800 } : undefined })} /> Lock viewport</label>
    {viewport && <>
      <label>Width<input type="number" min={1} max={16384} value={viewport.width || ''} onChange={event => change({ ...value,viewport:{ ...viewport,width:Number(event.target.value) } })} /></label>
      <label>Height<input type="number" min={1} max={16384} value={viewport.height || ''} onChange={event => change({ ...value,viewport:{ ...viewport,height:Number(event.target.value) } })} /></label>
    </>}
  </div>
  if (section === 'connection') return <div className={css.fields}>
    <label className={css.toggle}><input type="checkbox" checked={!!proxy} onChange={event => change({ ...value,proxy:event.target.checked ? { ...defaultProxy } : undefined })} /> Use proxy</label>
    {proxy?.route ? <p>Included route {proxy.route}</p> : proxy && <>
      <label>Protocol<select value={proxy.protocol} onChange={event => updateProxy({ protocol:event.target.value as ProfileProxy['protocol'] })}><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select></label>
      <label>Proxy host<input value={proxy.host} onChange={event => updateProxy({ host:event.target.value })} /></label>
      <label>Proxy port<input type="number" min={1} max={65535} value={proxy.port || ''} onChange={event => updateProxy({ port:Number(event.target.value) })} /></label>
      <label className={css.toggle}><input type="checkbox" checked={proxy.authenticated} onChange={event => updateProxy({ authenticated:event.target.checked })} /> Requires local credentials</label>
    </>}
  </div>
  let location = device?.geolocation
  let changeLocation = (key: 'latitude' | 'longitude' | 'accuracy', input: string) => { if (location) updateDevice({ geolocation:{ ...location,[key]:input === '' ? NaN : Number(input) } }) }
  return <div className={css.fields}>
    <label className={css.toggle}><input type="checkbox" checked={!!device} onChange={event => change({ ...value,device:event.target.checked ? { ...desktopDevice } : undefined })} /> Emulate a device</label>
    {device && <>
      <label>Device<select value={device.preset} onChange={event => { let preset = event.target.value as DevicePreset; updateDevice({ preset,...(preset === 'custom' ? {} : DEVICE_PRESETS[preset]) }) }}><option value="pixel-8">Pixel 8</option><option value="galaxy-s24">Galaxy S24</option><option value="iphone-15-pro">iPhone 15 Pro</option><option value="iphone-15-pro-max">iPhone 15 Pro Max</option><option value="custom">Custom</option></select></label>
      <label>Orientation<select value={device.orientation} onChange={event => updateDevice({ orientation:event.target.value as DevicePersona['orientation'] })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
      {device.preset === 'custom' && <>
        <label>Platform<select value={device.platform} onChange={event => updateDevice({ platform:event.target.value as DevicePersona['platform'] })}><option value="android">Android</option><option value="ios">iOS</option></select></label>
        <label>Device width<input type="number" value={device.width || ''} onChange={event => updateDevice({ width:Number(event.target.value) })} /></label>
        <label>Device height<input type="number" value={device.height || ''} onChange={event => updateDevice({ height:Number(event.target.value) })} /></label>
        <label>Device pixel ratio<input type="number" step="any" value={device.deviceScaleFactor || ''} onChange={event => updateDevice({ deviceScaleFactor:Number(event.target.value) })} /></label>
      </>}
      <label>Locale<input value={device.locale} onChange={event => updateDevice({ locale:event.target.value })} /></label>
      <label>Timezone<input value={device.timezone} onChange={event => updateDevice({ timezone:event.target.value })} /></label>
      <label className={css.toggle}><input type="checkbox" checked={!!location} onChange={event => updateDevice({ geolocation:event.target.checked ? { latitude:0,longitude:0,accuracy:100 } : undefined })} /> Override location</label>
      {location && <>
        <label>Latitude<input type="number" step="any" value={Number.isFinite(location.latitude) ? location.latitude : ''} onChange={event => changeLocation('latitude',event.target.value)} /></label>
        <label>Longitude<input type="number" step="any" value={Number.isFinite(location.longitude) ? location.longitude : ''} onChange={event => changeLocation('longitude',event.target.value)} /></label>
        <label>Accuracy<input type="number" step="any" value={Number.isFinite(location.accuracy) ? location.accuracy : ''} onChange={event => changeLocation('accuracy',event.target.value)} /></label>
      </>}
    </>}
  </div>
}
