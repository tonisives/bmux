import { useEffect, useId, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { flushSync } from 'react-dom'
import type { MediaDevice } from '../shared/types'
import { CloseButton } from './CloseButton'
import { MediaDeviceTest, mediaDeviceLabel } from './MediaDeviceTest'
import css from './MessageDialog.module.css'
import mediaCss from './MediaDeviceTest.module.css'

type MediaPermissionDialogProps = {
  origin: string
  devices: MediaDevice[]
  prepare: (device: MediaDevice) => Promise<boolean>
  respond: (allow: boolean) => Promise<unknown>
  defer: () => void
}

export let MediaPermissionDialog = ({ origin, devices, prepare, respond, defer }: MediaPermissionDialogProps) => {
  let dialog = useRef<HTMLDialogElement>(null)
  let title = useId()
  let [busy, setBusy] = useState(false)
  let [error, setError] = useState('')
  useEffect(() => { let element = dialog.current; element?.showModal(); return () => element?.close() }, [])
  let cancel = (event: SyntheticEvent) => { event.preventDefault(); if (!busy) defer() }
  let choose = async (allow: boolean) => {
    if (busy) return
    setError('')
    // Release the preview tracks before the requesting page starts capture.
    flushSync(() => setBusy(true))
    try {
      let result = await respond(allow) as { blocked?: MediaDevice[] } | undefined
      if (result?.blocked?.length) setError(`Allow ${mediaDeviceLabel(result.blocked)} access for bmux in System Settings → Privacy & Security.`)
    } catch (failure) {
      setError((failure instanceof Error ? failure.message : String(failure)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  return <dialog ref={dialog} className={`${css.prompt} ${mediaCss.permission}`} aria-labelledby={title} aria-describedby={`${title}-origin`} onCancel={cancel}>
    <div className={mediaCss.permissionHeader}>
      <h2 id={title}>Allow {mediaDeviceLabel(devices)} access?</h2>
      <CloseButton label="Review later" onClick={defer} disabled={busy} />
    </div>
    <p id={`${title}-origin`}>{origin}</p>
    {!busy && <MediaDeviceTest devices={devices} prepare={prepare} buttonClassName={mediaCss.testButton} />}
    {error && <p className={mediaCss.permissionError} role="alert">{error}</p>}
    <div className={css.actions}>
      <button type="button" disabled={busy} onClick={() => { void choose(false) }}>Deny</button>
      <button type="button" className={mediaCss.allow} disabled={busy} onClick={() => { void choose(true) }}>Allow</button>
    </div>
  </dialog>
}
