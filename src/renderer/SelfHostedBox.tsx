import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { AccountApi } from '../shared/remote-account'
import styles from './RemoteAccount.module.css'

export type HostEnrollment = { service: string; key: string; url?: string; name: string }
type Props = { enrollment?: HostEnrollment; active: boolean; busy: boolean; create: (name: string) => void; revoke: () => void; close: () => void }

export let useHostEnrollment = (api: AccountApi, act: (operation: () => Promise<unknown>) => Promise<void>, owner?: string) => {
  let [enrollment, setEnrollment] = useState<HostEnrollment>()
  useEffect(() => setEnrollment(undefined), [owner])
  let create = (name: string) => { void act(async () => {
    let prefix = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || 'box'
    let created = await api<Omit<HostEnrollment, 'name'>>('/api/services', { service: `${prefix}-${crypto.randomUUID().slice(0, 8)}` })
    setEnrollment({ ...created, name })
  }) }
  let revoke = () => { if (enrollment && window.confirm(`Revoke access for ${enrollment.name}? Hosts using this config will disconnect.`)) void act(async () => { await api('/api/services/revoke', { service: enrollment.service }); setEnrollment(undefined) }) }
  return { enrollment, create, revoke, reset: () => setEnrollment(undefined) }
}

export let SelfHostedBox = ({ enrollment, active, busy, create, revoke, close }: Props) => {
  let [name, setName] = useState('My box'), [download, setDownload] = useState('')
  let origin = enrollment?.url ?? (['http:', 'https:'].includes(location.protocol) ? location.origin : undefined)
  useEffect(() => {
    if (!enrollment || !origin) { setDownload(''); return }
    let url = URL.createObjectURL(new Blob([JSON.stringify({ url: origin, token: enrollment.key }, null, 2) + '\n'], { type: 'application/json' }))
    setDownload(url)
    return () => URL.revokeObjectURL(url)
  }, [enrollment, origin])
  let changeName = (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)
  let submit = (event: FormEvent) => { event.preventDefault(); if (name.trim() && active && !busy) create(name.trim()) }
  return <section className={styles.form} aria-label="Self-hosted box">
    <p>Run the open-source bmux host on your own machine.</p>
    {!enrollment ? <form onSubmit={submit} className={styles.selfHostForm}>
      <label>Box name<input value={name} onChange={changeName} maxLength={64} required disabled={busy} /></label>
      {!active && <p>Activate relay to connect this box.</p>}
      <button disabled={busy || !active || !name.trim()}>{busy ? 'Creating…' : 'Create host config'}</button>
    </form> : <>
      <strong>{enrollment.name}</strong>
      {origin ? <HostConfigDownload service={enrollment.service} download={download} /> : <p role="status">Update this relay to download a host config.</p>}
      <button onClick={revoke} disabled={busy}>Revoke key</button>
    </>}
    <div className={styles.actions}><a href="https://github.com/tonisives/bmux/blob/main/docs/remote-host.md#run-a-host" target="_blank" rel="noreferrer">Open-source setup</a><button onClick={close} disabled={busy}>Close</button></div>
  </section>
}

let HostConfigDownload = ({ service, download }: { service: string; download: string }) => <>
  <p>Save this file. It contains your host's access key.</p>
  <a className={styles.download} href={download || undefined} download={configFile(service)} aria-disabled={!download}>Download config</a>
  <details className={styles.setup}><summary>Run with Docker</summary><p>Copy the config to your host, then run these commands in the same folder.</p><pre tabIndex={0}><code>{dockerSetup(service)}</code></pre></details>
</>

let configFile = (service: string) => `bmux-${service}.json`
let dockerSetup = (service: string) => {
  let container = `bmux-${service}`, volume = `${container}-data`
  return `chmod 600 ${configFile(service)}
if [ ! -d bmux-source/.git ]; then
  git clone https://github.com/tonisives/bmux.git bmux-source
fi
docker build --target host -t bmux-host bmux-source
docker volume create ${volume}
docker run --rm -i --user 0 --entrypoint sh \\
  -v ${volume}:/data bmux-host -c '
  set -eu
  umask 077
  cat > /data/remote.json
  chown 1000:1000 /data/remote.json
' < ${configFile(service)}
docker run -d --name ${container} --hostname ${service} \\
  --restart unless-stopped --shm-size=256m \\
  --security-opt seccomp=bmux-source/containers/chromium-seccomp.json \\
  -v ${volume}:/data \\
  -e BMUX_REMOTE_CONFIG=/data/remote.json bmux-host`
}
