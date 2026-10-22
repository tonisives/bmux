export let pickerRemovalFocus = (row: HTMLElement | null, removed: Element | null = row) => {
  let picker = row?.closest<HTMLElement>('[data-picker]')
  let selector = row?.hasAttribute('data-bookmark-id') ? '[data-bookmark-id]:not([aria-disabled="true"])' : 'button:not(:disabled):not([data-picker-action])'
  let rows = [...(picker?.querySelectorAll<HTMLElement>(selector) ?? [])]
    .filter(item => item.getClientRects().length && !item.closest('details:not([open]) > :not(summary)'))
  let index = rows.indexOf(row!)
  let candidates = [...rows.slice(index + 1), ...rows.slice(0, index).reverse()].filter(item => !removed?.contains(item))
  let focus = () => {
    if (!picker?.isConnected) return
    let next = candidates.find(item => item.isConnected && item.getClientRects().length && !item.matches(':disabled, [aria-disabled="true"]'))
    if (next) { next.focus({ preventScroll: true }); next.scrollIntoView({ block: 'nearest' }) }
    else picker.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
  }
  return () => {
    if (!picker?.isConnected) return
    if (!removed?.isConnected) { requestAnimationFrame(focus); return }
    let observer = new MutationObserver(() => {
      if (removed.isConnected && picker.isConnected) return
      observer.disconnect(); requestAnimationFrame(focus)
    })
    observer.observe(picker, { childList: true, subtree: true })
  }
}
