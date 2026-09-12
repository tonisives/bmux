import { useRef } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import css from './KeyboardShortcuts.module.css'
import pageCss from './SundayPage.module.css'

export let KeyboardShortcuts = () => {
  let dialog = useRef<HTMLDialogElement>(null)
  let closeButton = useRef<HTMLButtonElement>(null)
  let backdropPressed = useRef(false)
  let openShortcuts = () => dialog.current?.showModal()
  let closeShortcuts = () => dialog.current?.close()
  let keepFocusInside = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return
    event.preventDefault()
    closeButton.current?.focus()
  }
  let pressBackdrop = (event: PointerEvent<HTMLDialogElement>) => { backdropPressed.current = isBackdrop(event) }
  let clickBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (backdropPressed.current && isBackdrop(event)) closeShortcuts()
    backdropPressed.current = false
  }
  return <>
    <button type="button" className={pageCss.secondaryButton} onClick={openShortcuts} aria-haspopup="dialog" aria-controls="keyboard-shortcuts">Keyboard shortcuts</button>
    <dialog ref={dialog} id="keyboard-shortcuts" className={css.dialog} aria-labelledby="shortcuts-title" onPointerDown={pressBackdrop} onClick={clickBackdrop} onKeyDown={keepFocusInside}>
      <header className={css.header}><h2 id="shortcuts-title">Keyboard shortcuts</h2><button ref={closeButton} type="button" onClick={closeShortcuts} autoFocus>Close</button></header>
      <ShortcutGroups />
      <p className={css.note}>Default shortcuts · Customize them in bmux</p>
    </dialog>
  </>
}

let ShortcutGroups = () => <div className={css.groups}>
  <section aria-labelledby="prefix-title"><h3 id="prefix-title">Press <kbd>Ctrl</kbd> <kbd>B</kbd>, then</h3><ShortcutList shortcuts={PREFIX_SHORTCUTS} /></section>
  <section aria-labelledby="direct-title"><h3 id="direct-title">Direct shortcuts</h3><ShortcutList shortcuts={DIRECT_SHORTCUTS} /></section>
</div>

let ShortcutList = ({ shortcuts }: { shortcuts: { key: string; label: string }[] }) => <dl>{shortcuts.map(shortcut => <div key={shortcut.key}><dt>{shortcut.label}</dt><dd><kbd>{shortcut.key}</kbd></dd></div>)}</dl>

let isBackdrop = (event: MouseEvent<HTMLDialogElement> | PointerEvent<HTMLDialogElement>) => {
  let bounds = event.currentTarget.getBoundingClientRect()
  return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom
}

let PREFIX_SHORTCUTS = [
  { key: '%', label: 'Split side by side' },
  { key: '"', label: 'Split above and below' },
  { key: 'o', label: 'Next pane' },
  { key: 'z', label: 'Toggle full pane' },
  { key: 's', label: 'Switch sessions' },
  { key: 'c', label: 'New window' },
  { key: ':', label: 'Command prompt' },
  { key: '?', label: 'Help' },
]
let DIRECT_SHORTCUTS = [
  { key: 'Cmd L', label: 'Open URL' },
  { key: 'Cmd T', label: 'New tab' },
  { key: 'Cmd W', label: 'Close tab' },
  { key: 'Cmd R', label: 'Reload page' },
  { key: 'Cmd F', label: 'Find on page' },
  { key: 'F1', label: 'Help' },
]
