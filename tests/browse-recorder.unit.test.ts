import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBrowseRecorder } from '../src/main/browse-recorder'
import { parseBrowseRecording } from '../src/main/config'

describe('social browse archive', () => {
  it('defaults both local capture modes on and validates edits', () => {
    expect(parseBrowseRecording(undefined)).toEqual({ enabled: true, manual: true })
    expect(() => parseBrowseRecording({ enabled: 'yes' })).toThrow()
  })
  it('serializes writes and combines X URL variants while retaining changed images', async () => {
    let directory = await mkdtemp(path.join(tmpdir(), 'bmux-history-'))
    try {
      let recorder = createBrowseRecorder({ directory }), state = { ok: true, identity: 'post', postURL: 'https://x.com/author/status/123', text: 'First post' }
      let image = { format: 'jpeg', data: Buffer.from([255, 216, 255, 217]).toString('base64') }
      let context = { platform: 'x', profileId: 'fixture-profile', session: 'fixture-session' }
      await Promise.all([recorder.store(state, image, context), recorder.store(state, image, context)])
      await recorder.store({ ...state, postURL: 'https://twitter.com/other/status/123', text: 'Updated post' }, { ...image, data: Buffer.from([255, 216, 0, 217]).toString('base64') }, context)
      let folders = await readdir(path.join(directory, 'automation/social-media/x'))
      expect(folders).toHaveLength(1)
      let folder = path.join(directory, 'automation/social-media/x', folders[0])
      let data = JSON.parse(await readFile(path.join(folder, 'post.json'), 'utf8'))
      expect(data.observations).toHaveLength(2)
      await recorder.store(state, image, { ...context, mode: 'manual' })
      expect(await readdir(path.join(directory, 'manual/social-media/x'))).toHaveLength(1)
      expect(data.mode).toBe('automation')
      expect(await readdir(path.join(folder, 'images'))).toHaveLength(2)
      expect(await readFile(path.join(folder, 'post.md'), 'utf8')).toContain('Updated post')
      await expect(recorder.store(state, { format: 'jpeg', data: 'invalid' }, context)).rejects.toThrow()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
