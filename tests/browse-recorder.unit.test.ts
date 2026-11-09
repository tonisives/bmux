import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBrowseRecorder } from '../src/main/browse-recorder'
import { parseBrowseRecording } from '../src/main/config'

describe('social browse archive', () => {
  for (let stage of ['inspection', 'screenshot']) it(`continues after a stuck ${stage} without overlapping or saving expired captures`, async () => {
    let directory = await mkdtemp(path.join(tmpdir(), 'bmux-stalled-history-'))
    try {
      let plugins = path.join(directory, 'plugins'), contribution = path.join(plugins, 'bmux.x/simulation')
      await mkdir(contribution, { recursive: true })
      await writeFile(path.join(contribution, 'capture.json'), JSON.stringify({ hosts: ['x.com'], expression: 'fixture' }))
      let recorder = createBrowseRecorder({ directory, captureTimeoutMs: 200 })
      let state = { ok: true, identity: 'https://x.com/fixture/status/123', text: 'Post', cardRect: { x: 0, y: 0, width: 100, height: 100 }, viewport: [100, 100] }
      let frame: any = { isEmpty: () => false, getSize: () => ({ width: 100, height: 100 }), crop: () => frame, toJPEG: () => Buffer.from([255, 216, 255, 217]) }
      let release!: (value: any) => void, stalled = new Promise(resolve => { release = resolve })
      let inspections = 0, screenshots = 0
      let page: any = { getURL: () => state.identity, isDestroyed: () => false, isCrashed: () => false,
        executeJavaScript: () => { inspections++; return stage === 'inspection' ? stalled : Promise.resolve(state) },
        capturePage: () => { screenshots++; return stalled },
      }
      let context = { profileId: 'fixture-profile', session: 'fixture-session', mode: 'manual' }
      await recorder.capture(page, plugins, context, () => true)
      expect(recorder.error).toBe('Browse capture timed out')
      await recorder.capture(page, plugins, context, () => true)
      expect(inspections).toBe(1)
      expect(screenshots).toBe(stage === 'screenshot' ? 1 : 0)
      let healthy: any = { ...page, executeJavaScript: async () => state, capturePage: async () => frame }
      await recorder.capture(healthy, plugins, context, () => true)
      let folders = await readdir(path.join(directory, 'manual/social-media/x'))
      let file = path.join(directory, 'manual/social-media/x', folders[0], 'post.json')
      expect(JSON.parse(await readFile(file, 'utf8')).observations).toHaveLength(1)
      release(stage === 'inspection' ? { ...state, identity: 'expired' } : frame)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(await readdir(path.join(directory, 'manual/social-media/x'))).toHaveLength(1)
      expect(JSON.parse(await readFile(file, 'utf8')).observations).toHaveLength(1)
      expect(inspections).toBe(1)
      expect(screenshots).toBe(stage === 'screenshot' ? 1 : 0)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
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
