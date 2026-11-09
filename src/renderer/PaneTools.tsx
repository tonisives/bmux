import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { DevicePlatform, DevicePreset, PublicState } from '../shared/types'
import { connectionProfile, paneConnectionId } from '../shared/profile-connections'
import { PROFILE_COLORS, profileHash, profileColor } from '../shared/profile-color'
import css from './App.module.css'

export type PaneToolControl = 'profiles' | 'extensions' | 'proxy' | 'adblock-popup' | 'dark-mode-popup'

type PaneToolsProps = {
  state: PublicState
  paneId?: string
  control?: string | null
  show: (control: PaneToolControl, paneId?: string) => unknown
  run: (method: string, args?: Record<string, unknown>) => Promise<unknown>
  inlineProfilePicker?: boolean
}

export let PaneTools = ({ state, paneId, control, show, run, inlineProfilePicker = true }: PaneToolsProps) => {
  let client = state.model.clients.find(client => client.id === state.clientId)
  let session = state.model.sessions.find(session => session.id === client?.sessionId)
  let pane = session?.windows.find(window => window.id === client?.windowId)?.panes.find(pane => pane.id === paneId)
  let tab = pane
  let profile = state.model.profiles.find(profile => profile.id === pane?.profileId)
  let [profilePickerOpen, setProfilePickerOpen] = useState(false)
  let profilePicker = useRef<HTMLDivElement>(null)
  let blocking = tab ? state.browserTools?.tabs[tab.id] : undefined
  let openAdblock = () => show('adblock-popup', paneId)
  let openDarkMode = () => show('dark-mode-popup', paneId)
  let openExtensions = () => show('extensions', paneId)
  let openProfile = () => show('profiles', paneId)
  let openProxy = () => show('proxy', paneId)
  let blank = inlineProfilePicker && !!pane && !session?.private && pane.url === 'about:blank' && !state.pendingUrls[pane.id] && !state.loading[pane.id] && !(state.navigation[pane.id]?.entries.some(entry => entry.url !== 'about:blank'))
  let choosePaneProfile = (event: ChangeEvent<HTMLSelectElement>) => {
    if (pane) void run('pane.profile.set', { pane: pane.id, profile: event.target.value })
    setProfilePickerOpen(false)
  }
  let togglePaneProfile = () => { if (blank) setProfilePickerOpen(open => !open); else openProfile() }
  let profileOptions = state.model.profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)
  useEffect(() => { setProfilePickerOpen(false) }, [paneId, blank])
  useEffect(() => {
    if (!profilePickerOpen) return
    let outside = (event: globalThis.PointerEvent) => { if (!profilePicker.current?.contains(event.target as Node)) setProfilePickerOpen(false) }
    let escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setProfilePickerOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [profilePickerOpen])
  let customProfile = profile && session && !session.private && profile.id !== session.defaultProfileId ? profile : undefined
  let paneProxy = pane ? connectionProfile(state.model, paneConnectionId(pane)) : undefined
  let proxyTest = paneProxy ? state.profileProxyTests[paneProxy.id] : undefined
  let profileRouteLabel = profile ? `Profile: ${profile.name}` : 'Profile'
  let profileRouteTitle = profile ? `${profileRouteLabel}, ${profileDeviceLabel(pane!)}` : profileRouteLabel
  let proxyFailure = paneProxy ? state.profileProxyFailures[paneProxy.id] : undefined
  let proxyRouteLabel = profile && paneProxy?.proxy ? `Proxy for ${profile.name}${proxyFailure ? ', unavailable' : ''}` : ''
  let proxyRouteTitle = proxyFailure ? `Proxy unavailable · ${proxyFailure.error}` : proxyTest ? `Proxy verified · Exit IP: ${proxyTest.ip}` : paneProxy?.proxy ? `${paneProxy.proxy.protocol}://${paneProxy.proxy.host}:${paneProxy.proxy.port}` : ''
  return <div className={css.paneTools}>
      {profile && <div ref={profilePicker} className={css.profileRouteControls}>{!session?.private && <button type="button" className={css.profileRoute} onClick={togglePaneProfile} aria-label={blank ? `Choose pane profile: ${profile.name}` : profileRouteLabel} title={blank ? `Choose pane profile: ${profile.name}` : profileRouteTitle}><ProfileAvatar id={profile.id} name={profile.name} />{customProfile && pane?.device && <ProfileDeviceIcon />}</button>}<button type="button" className={css.profileRoute} onClick={openExtensions} aria-label="Extensions" title="Extensions"><ExtensionsIcon /></button>{paneProxy?.proxy && <button type="button" className={css.profileRoute} onClick={openProxy} aria-label={proxyRouteLabel} title={proxyRouteTitle} data-proxy-failed={!!proxyFailure || undefined}><ProfileConnectionIcon proxy verified={!!proxyTest} /></button>}{blank && profilePickerOpen && <label className={css.paneProfilePicker}>Pane profile<select aria-label="Pane profile" value={profile.id} onChange={choosePaneProfile} autoFocus>{profileOptions}</select><button type="button" onClick={openProfile}>Profile settings</button></label>}</div>}
      {tab && <button type="button" className={`${css.navigationButton} ${css.adblockButton}`} data-plugin-pane={tab.id} data-plugin-button="adblock" data-enabled={blocking?.adblock ?? false} aria-label="Ad blocking" aria-haspopup="dialog" aria-expanded={control === 'adblock-popup' && client?.paneId === tab.id} title={`Ad blocking ${blocking?.adblock ? 'on' : 'off'}`} disabled={!blocking} onClick={openAdblock}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 13 3.5v4c0 3-2 5-5 7-3-2-5-4-5-7v-4Z" />{blocking?.adblock ? <path d="m5.5 8 1.5 1.5 3.5-3.5" /> : <path d="m5.5 5.5 5 5" />}</svg></button>}
      {tab && state.showDarkModeButton && <button type="button" className={`${css.navigationButton} ${css.adblockButton}`} data-plugin-pane={tab.id} data-plugin-button="dark-mode" data-enabled={!!blocking && blocking.darkMode !== 'off'} aria-label="Dark mode" aria-haspopup="dialog" aria-expanded={control === 'dark-mode-popup' && client?.paneId === tab.id} title={`Dark mode ${blocking?.darkMode ?? 'off'}`} disabled={!blocking} onClick={openDarkMode}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.5A5.8 5.8 0 0 1 6.5 2a5.8 5.8 0 1 0 7 7.5Z" /></svg></button>}
    </div>
}

let profileDeviceLabel = (pane: { device?: { preset: DevicePreset; platform: DevicePlatform } }) => !pane.device ? 'desktop' : ({ 'pixel-8': 'Pixel 8', 'galaxy-s24': 'Galaxy S24', 'iphone-15-pro': 'iPhone 15 Pro', 'iphone-15-pro-max': 'iPhone 15 Pro Max', custom: pane.device.platform === 'android' ? 'Android' : 'iOS' })[pane.device.preset]

export let ProfileAvatar = ({ id, name }: { id: string; name: string }) => {
  let hash = profileHash(id), background = profileColor(id), foreground = PROFILE_COLORS[(hash >>> 5) % PROFILE_COLORS.length]
  let left = 3 + (hash % 5), top = 3 + ((hash >>> 3) % 5), radius = 4 + ((hash >>> 6) % 3)
  return <svg className={css.profileAvatar} viewBox="0 0 20 20" aria-hidden="true" data-profile-avatar={id}>
    <rect width="20" height="20" fill={background} />
    <circle cx={left} cy={top} r={radius} fill={foreground} opacity=".9" />
    <path d={`M0 ${12 + (hash % 4)} Q${8 + (hash % 5)} ${5 + ((hash >>> 8) % 5)} 20 ${11 + ((hash >>> 11) % 5)} V20 H0Z`} fill="#17202a" opacity=".45" />
    <text x="10" y="14" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="700" fontFamily="ui-monospace, monospace">{name.trim().charAt(0).toUpperCase()}</text>
  </svg>
}

let ProfileDeviceIcon = () => <svg className={css.profileRouteIcon} viewBox="0 0 18 18" aria-hidden="true" data-profile-route-icon="device"><rect x="5" y="1.5" width="8" height="15" rx="1" /><path d="M8 14h2" /></svg>

export let ProfileConnectionIcon = ({ proxy, verified = false }: { proxy: boolean; verified?: boolean }) => proxy
  ? <svg className={`${css.profileRouteIcon} ${verified ? css.profileRouteIconVerified : ''}`} viewBox="0 0 18 18" aria-hidden="true" data-profile-route-icon="connection" data-proxy-verified={verified || undefined}><circle cx="4" cy="5" r="1.5" /><circle cx="14" cy="4" r="1.5" /><circle cx="13" cy="14" r="1.5" /><path d="m5.5 5 7-1M5 6.2l7 6.6" /></svg>
  : <svg className={css.profileRouteIcon} viewBox="0 0 18 18" aria-hidden="true" data-profile-route-icon="connection"><circle cx="9" cy="9" r="7" /><path d="M2 9h14M9 2c2 2 3 4.3 3 7s-1 5-3 7c-2-2-3-4.3-3-7s1-5 3-7Z" /></svg>

let ExtensionsIcon = () => <svg className={css.statusIcon} viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7h4V5a2 2 0 0 1 4 0v2h4v9h-4v-2a2 2 0 0 0-4 0v2H4Z" /></svg>
