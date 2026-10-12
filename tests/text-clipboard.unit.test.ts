import { expect, test, vi } from 'vitest'
import { createTextClipboard } from '../src/main/text-clipboard'

test('a read waits for the preceding yank to reach the system clipboard', async () => {
  let complete: () => void = () => undefined, text = ''
  let writeText = vi.fn((value: string) => new Promise<void>(resolve => { complete = () => { text = value; resolve() } }))
  let readText = vi.fn(async () => text), clipboard = createTextClipboard({ readText, writeText })
  let write = clipboard('yanked'), read = clipboard()
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('yanked'))
  expect(readText).not.toHaveBeenCalled()
  complete(); await write
  expect(await read).toBe('yanked')
})

test('a rejected write does not block subsequent clipboard access', async () => {
  let clipboard = createTextClipboard({ readText: async () => 'external', writeText: async () => { throw new Error('unavailable') } })
  await expect(clipboard('draft')).rejects.toThrow('unavailable')
  expect(await clipboard()).toBe('external')
})
