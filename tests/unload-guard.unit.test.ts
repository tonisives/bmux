import { expect, test, vi } from 'vitest'
import { createUnloadGuard } from '../src/main/unload-guard'

let choice = () => {
  let resolve!: (leave: boolean) => void
  let result = new Promise<boolean>(done => { resolve = done })
  return { result, resolve, cancel: vi.fn(() => resolve(false)) }
}

test('staying preserves the aborted navigation without replaying it', async () => {
  let answer = choice(), confirm = vi.fn(() => answer)
  let guard = createUnloadGuard(confirm, () => undefined)
  let operation = vi.fn(async () => { expect(guard.handle({ preventDefault: () => { throw new Error('Must stay') } })).toBe(true); throw new Error('ERR_ABORTED') })
  let pending = guard.run(operation, undefined)
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce())
  answer.resolve(false)
  await pending
  expect(operation).toHaveBeenCalledOnce()
  expect(guard.handle({ preventDefault: vi.fn() })).toBe(false)
})

test('leaving replays the operation with approval for only its next unload', async () => {
  let answer = choice(), confirm = vi.fn(() => answer), preventDefault = vi.fn(), blocked = vi.fn()
  let guard = createUnloadGuard(confirm, blocked)
  let operation = vi.fn(async () => { guard.handle({ preventDefault }); return preventDefault.mock.calls.length > 0 })
  let pending = guard.run(operation, false)
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce())
  expect(preventDefault).not.toHaveBeenCalled()
  answer.resolve(true)
  expect(await pending).toBe(true)
  expect(operation).toHaveBeenCalledTimes(2)
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(blocked).toHaveBeenCalledOnce()
  expect(guard.handle({ preventDefault })).toBe(false)
})

test('new navigation cancels an older prompt and cannot inherit its approval', async () => {
  let answer = choice(), confirm = vi.fn(() => answer)
  let guard = createUnloadGuard(confirm, () => undefined)
  let original = vi.fn(async () => { guard.handle({ preventDefault: vi.fn() }); return 'old' })
  let pending = guard.run(original, 'cancelled')
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce())
  expect(await guard.run(async () => 'new', 'cancelled')).toBe('new')
  expect(await pending).toBe('cancelled')
  expect(answer.cancel).toHaveBeenCalledOnce()
  expect(original).toHaveBeenCalledOnce()
})

test('unrelated navigation failures propagate without prompting or retaining approval', async () => {
  let confirm = vi.fn(() => choice()), guard = createUnloadGuard(confirm, () => undefined)
  await expect(guard.run(async () => { throw new Error('Network failed') }, undefined)).rejects.toThrow('Network failed')
  expect(confirm).not.toHaveBeenCalled()
  expect(guard.handle({ preventDefault: vi.fn() })).toBe(false)
})

test('canceling releases an operation that is waiting for navigation events', async () => {
  let resolve!: () => void
  let guard = createUnloadGuard(() => choice(), () => undefined)
  let interrupt = vi.fn(() => resolve())
  let pending = guard.run(() => new Promise<void>(done => { resolve = done }), undefined, interrupt)
  guard.cancel()
  await pending
  expect(interrupt).toHaveBeenCalledOnce()
  expect(guard.handle({ preventDefault: vi.fn() })).toBe(false)
})
