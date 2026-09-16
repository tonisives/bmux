import { describe, expect, it } from 'vitest'
import { deleteWordBackward } from '../src/shared/text-edit'

describe('deleteWordBackward', () => {
  it('deletes successive words and their separating whitespace', () => {
    let first = deleteWordBackward('search these words', 18, 18)
    expect(first).toEqual({ value: 'search these ', cursor: 13 })
    expect(deleteWordBackward(first.value, first.cursor, first.cursor)).toEqual({ value: 'search ', cursor: 7 })
  })

  it('deletes a selection before deleting the previous word', () => {
    expect(deleteWordBackward('before selected after', 7, 16)).toEqual({ value: 'before after', cursor: 7 })
  })
})
