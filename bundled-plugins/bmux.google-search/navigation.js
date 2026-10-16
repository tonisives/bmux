(() => {
  globalThis.__bmuxGoogleNavigation?.()
  let selected, previousOutline = '', previousOffset = ''
  let clear = () => {
    if (!selected) return
    selected.style.outline = previousOutline; selected.style.outlineOffset = previousOffset
    selected = undefined
  }
  let keydown = event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return
    if (document.querySelector('[data-bmux-click-mode],[data-bmux-vim]')) return
    let active = event.composedPath()[0]
    if (active instanceof Element && active.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="listbox"],[role="menu"],[role="dialog"]')) return
    if (event.key === 'Escape') { clear(); return }
    if (event.key === 'Enter') {
      if (selected?.isConnected && document.activeElement === selected) { event.preventDefault(); selected.click() }
      return
    }
    let results = [...new Set([...document.querySelectorAll('#search a[href]:has(h3),#rso a[href]:has(h3)')])].filter(link => {
      let heading = link.querySelector('h3')
      return heading.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && heading.getClientRects().length > 0
    })
    if (!results.length) { clear(); return }
    let index = results.indexOf(selected)
    if (index < 0) {
      let visible = results.findIndex(link => link.querySelector('h3').getBoundingClientRect().bottom > 0)
      index = event.key === 'ArrowDown' ? Math.max(0, visible) : Math.max(0, visible - 1)
    } else index = Math.max(0, Math.min(results.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    clear(); selected = results[index]
    previousOutline = selected.style.outline; previousOffset = selected.style.outlineOffset
    selected.style.outline = '2px solid #4285f4'; selected.style.outlineOffset = '4px'
    selected.focus({ preventScroll: true })
    selected.querySelector('h3').scrollIntoView({ block: 'center', behavior: 'instant' })
    event.preventDefault()
  }
  window.addEventListener('keydown', keydown)
  globalThis.__bmuxGoogleNavigation = () => { window.removeEventListener('keydown', keydown); clear() }
})()
