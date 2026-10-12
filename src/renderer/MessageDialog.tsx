import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, SyntheticEvent } from 'react'
import type { DialogPrompt } from '../shared/types'
import css from './MessageDialog.module.css'

export let MessageDialog = ({ prompt, respond }: { prompt: DialogPrompt; respond: (response: number) => Promise<unknown> }) => {
  let dialog = useRef<HTMLDialogElement>(null)
  let [busy, setBusy] = useState(false)
  useEffect(() => { let element = dialog.current; element?.showModal(); return () => element?.close() }, [])
  let choose = (response: number) => { if (busy) return; setBusy(true); void respond(response) }
  let click = (event: MouseEvent<HTMLButtonElement>) => choose(Number(event.currentTarget.dataset.response))
  let cancel = (event: SyntheticEvent) => { event.preventDefault(); choose(prompt.cancelId) }
  let keys = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    if (event.key !== 'Escape' && event.key !== 'Enter') return
    event.preventDefault(); event.stopPropagation(); choose(event.key === 'Enter' ? prompt.defaultId : prompt.cancelId)
  }
  return <dialog ref={dialog} className={css.prompt} role="alertdialog" aria-labelledby="dialog-title" aria-describedby={prompt.detail ? 'dialog-description' : undefined} onCancel={cancel} onKeyDown={keys}>
    <h2 id="dialog-title">{prompt.message}</h2>
    {prompt.detail && <p id="dialog-description">{prompt.detail}</p>}
    <div className={css.actions}>{prompt.buttons.map((label, index) => <button key={`${index}:${label}`} data-response={index} autoFocus={index === prompt.cancelId} disabled={busy} onClick={click}>{label} {index === prompt.cancelId || index === prompt.defaultId ? <span>({[index === prompt.cancelId && 'esc', index === prompt.defaultId && 'enter'].filter(Boolean).join(' / ')})</span> : null}</button>)}</div>
  </dialog>
}
