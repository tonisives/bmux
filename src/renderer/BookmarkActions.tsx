import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import type { Bookmark } from '../shared/types'
import css from './BookmarkActions.module.css'

type Target = { bookmark: Bookmark; profileId: string }
type Menu = Target & { x: number; y: number; origin: HTMLElement }
type Actions = { editing: string | null; rename: (target: Target) => void; finish: () => void; menu: (event: MouseEvent<HTMLElement>, target: Target) => void; menuKeys: (event: KeyboardEvent<HTMLElement>, target: Target) => void; run: (method: string, args: Record<string, unknown>) => Promise<unknown>; focusSearch: () => void }
export let useBookmarkActions = () => useContext(Context)!

export let BookmarkActions = ({ children, run, focusSearch }: { children: ReactNode; run: Actions['run']; focusSearch: () => void }) => {
  let [editing, setEditing] = useState<string | null>(null)
  let [popup, setPopup] = useState<Menu | null>(null)
  let rename = (target: Target) => { setPopup(null); setEditing(targetKey(target)) }
  let finish = () => setEditing(null)
  let menu = (event: MouseEvent<HTMLElement>, target: Target) => {
    event.preventDefault(); event.stopPropagation()
    let origin = (event.target as HTMLElement).closest<HTMLElement>('button, summary') ?? event.currentTarget
    setPopup({ ...target, x: event.clientX, y: event.clientY, origin })
  }
  let menuKeys = (event: KeyboardEvent<HTMLElement>, target: Target) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault(); event.stopPropagation()
    let origin = event.target as HTMLElement, bounds = origin.getBoundingClientRect()
    setPopup({ ...target, x: bounds.left, y: bounds.bottom, origin })
  }
  let close = (restore = false) => { setPopup(null); if (restore) popup?.origin.focus({ preventScroll: true }) }
  return <Context.Provider value={{ editing, rename, finish, menu, menuKeys, run, focusSearch }}><div className={css.list} data-bookmark-list data-menu-open={!!popup}>{children}</div>{popup && <BookmarkMenu popup={popup} close={close} />}</Context.Provider>
}

export let BookmarkTitle = ({ bookmark, profileId }: Target) => {
  let { editing } = useBookmarkActions()
  if (editing === targetKey({ bookmark, profileId })) return <BookmarkRename bookmark={bookmark} profileId={profileId} />
  return <span data-bookmark-folder-title={bookmark.children ? true : undefined} data-bookmark-title>{bookmark.title || bookmark.url || 'Untitled folder'}</span>
}

let Context = createContext<Actions | null>(null)
let targetKey = ({ bookmark, profileId }: Target) => JSON.stringify([profileId, bookmark.id])
let BookmarkMenu = ({ popup, close }: { popup: Menu; close: (restore?: boolean) => void }) => {
  let { run, rename, focusSearch } = useBookmarkActions()
  let ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    let menu = ref.current!
    menu.style.left = `${Math.max(8, Math.min(popup.x, innerWidth - menu.offsetWidth - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(popup.y, innerHeight - menu.offsetHeight - 8))}px`
    menu.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [popup])
  useEffect(() => {
    let move = () => close()
    document.addEventListener('wheel', move, { passive: true })
    window.addEventListener('resize', move)
    return () => { document.removeEventListener('wheel', move); window.removeEventListener('resize', move) }
  }, [close])
  let dismiss = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    event.preventDefault(); event.stopPropagation(); close(true)
  }
  let edit = () => rename(popup)
  let remove = async () => {
    close(); focusSearch()
    await run('bookmark.remove', { profile: popup.profileId, bookmark: popup.bookmark.id })
  }
  let keys = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close(true); return }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    let items = [...ref.current!.querySelectorAll<HTMLButtonElement>('button')], index = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
    items[next]?.focus()
  }
  return createPortal(<div className={css.backdrop} onClick={dismiss} onContextMenu={dismiss}><div ref={ref} className={css.menu} role="menu" aria-label={`Actions for ${popup.bookmark.title || popup.bookmark.url}`} onKeyDown={keys}><button type="button" role="menuitem" onClick={edit}>Rename</button><button type="button" role="menuitem" onClick={remove}>{popup.bookmark.children ? 'Delete folder and bookmarks' : 'Delete'}</button></div></div>, document.body)
}

let BookmarkRename = ({ bookmark, profileId }: Target) => {
  let { run, finish, focusSearch } = useBookmarkActions()
  let [title, setTitle] = useState(bookmark.title)
  let ref = useRef<HTMLInputElement>(null), done = useRef(false)
  useLayoutEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  let change = (event: ChangeEvent<HTMLInputElement>) => { setTitle(event.target.value); event.target.setCustomValidity('') }
  let save = async (focus = false) => {
    if (done.current) return
    if (!title.trim()) {
      if (focus) { ref.current?.setCustomValidity('Enter a bookmark title'); ref.current?.reportValidity() }
      else finish()
      return
    }
    done.current = true
    let result = title.trim() === bookmark.title ? true : await run('bookmark.update', { profile: profileId, bookmark: bookmark.id, title })
    if (result === undefined) { done.current = false; ref.current?.focus(); return }
    finish(); if (focus) focusSearch()
  }
  let blur = () => { void save() }
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') { event.preventDefault(); void save(true) }
    if (event.key === 'Escape') { event.preventDefault(); done.current = true; finish(); focusSearch() }
  }
  let click = (event: MouseEvent<HTMLInputElement>) => event.stopPropagation()
  return <input ref={ref} className={css.rename} aria-label="Bookmark title" value={title} maxLength={200} onChange={change} onBlur={blur} onKeyDown={keys} onClick={click} autoComplete="off" spellCheck={false} />
}
