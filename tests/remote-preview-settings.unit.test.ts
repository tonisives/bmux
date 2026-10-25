import { expect, it } from 'vitest'
import { DEFAULT_REMOTE_PREVIEWS, parseRemotePreviews } from '../src/shared/remote-preview-settings'
import { parseConfig } from '../src/main/config'

it('defaults to saving previews locally and fetching missing images', () => {
  expect(parseRemotePreviews(undefined)).toEqual(DEFAULT_REMOTE_PREVIEWS)
  expect(parseConfig('keyboard: {}').remotePreviews).toEqual(DEFAULT_REMOTE_PREVIEWS)
})
it('reads partial preview preferences and rejects invalid update modes', () => {
  expect(parseRemotePreviews({ saveLocally: false })).toEqual({ updates: 'missing', saveLocally: false })
  expect(parseConfig('keyboard: {}\nremotePreviews:\n  updates: manual\n  saveLocally: false').remotePreviews).toEqual({ updates: 'manual', saveLocally: false })
  for (let value of [[], true, { updates: 'always' }, { updates: ['open'] }, { saveLocally: 'false' }, { unknown: true }]) expect(() => parseRemotePreviews(value)).toThrow()
})
