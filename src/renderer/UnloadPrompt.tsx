import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, SyntheticEvent } from 'react'
import css from './UnloadPrompt.module.css'

export let UnloadPrompt = ({ respond }: { respond: (leave: boolean) => Promise<unknown> }) => {
  let dialog = useRef<HTMLDialogElement>(null)
  let [busy, setBusy] = useState(false)
  useEffect(() => { let element = dialog.current; element?.showModal(); return () => element?.close() }, [])
  let choose = (leave: boolean) => { if (busy) return; setBusy(true); void respond(leave) }
  let stay = () => choose(false)
  let leave = () => choose(true)
  let cancel = (event: SyntheticEvent) => { event.preventDefault(); stay() }
  let keys = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    if (event.key !== 'Escape' && event.key !== 'Enter') return
    event.preventDefault(); event.stopPropagation(); choose(event.key === 'Enter')
  }
  return <dialog ref={dialog} className={css.prompt} role="alertdialog" aria-labelledby="unload-title" aria-describedby="unload-description" onCancel={cancel} onKeyDown={keys}>
    <h2 id="unload-title">Leave this site?</h2>
    <p id="unload-description">Changes you made may not be saved.</p>
    <div className={css.actions}><button autoFocus disabled={busy} onClick={stay}>Stay <span>(esc)</span></button><button disabled={busy} onClick={leave}>Leave <span>(enter)</span></button></div>
  </dialog>
}
