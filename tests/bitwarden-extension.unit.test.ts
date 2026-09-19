import { describe, expect, it } from 'vitest'
import { patchBitwardenInlineNewItem } from '../src/main/bitwarden-extension'

let source = 'before;const d=chrome.runtime.getURL("popup/index.html"),h=(yield YO.tabsQuery({url:`${d}*`})).find(e=>{var t;return null===(t=e.url)||void 0===t?void 0:t.includes(`singleActionPopout=${o}`)});try{yield chrome.runtime.sendMessage({command:"reloadAddEditCipherData",data:{cipherId:i,cipherType:r}}),yield YO.updateWindowProperties(h.windowId,{focused:!0})}catch(e){yield aN.openPopout(l,{singleActionKey:o,senderWindowId:s})};after'

describe('Bitwarden inline New item compatibility', () => {
  it('opens a new popout before messaging an editor that does not exist', () => {
    let patched = patchBitwardenInlineNewItem(source)
    expect(patched).toContain('if(!h){yield aN.openPopout(l,{singleActionKey:o,senderWindowId:s});/* bmux-inline-new-item-existing-popout-check */return}try{yield chrome.runtime.sendMessage')
    expect(patchBitwardenInlineNewItem(patched)).toBe(patched)
  })

  it('fails installation when the pinned Bitwarden bundle no longer matches', () => {
    expect(() => patchBitwardenInlineNewItem('changed upstream bundle')).toThrow('compatibility target was not found')
  })
})
