import { it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAttentionRequests } from '../src/main/remote-attention'

it('persists a pause, deduplicates an episode, and rejects stale human resumes', () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(),'bmux-attention-test-')), file = path.join(directory,'attention.json')
  try {
    let requests = createAttentionRequests(file)
    let first = requests.request('pane-one','session','scrape-42')
    expect(requests.request('pane-one','session','scrape-42')).toEqual(first)
    expect(() => requests.assert('pane-one')).toThrow('paused for human help')
    expect(() => requests.request('pane-two','session','scrape-42')).toThrow('another pane')
    expect(() => requests.resolve('pane-one','obsolete')).toThrow('request changed')
    let restored = createAttentionRequests(file)
    expect(() => restored.assert('pane-one')).toThrow('paused for human help')
    restored.resolve('pane-one','scrape-42'); expect(() => restored.assert('pane-one')).not.toThrow()
    expect(restored.request('pane-one','session','scrape-42').resolvedAt).toBeTruthy()
    expect(restored.active()).toEqual([])
    expect(fs.statSync(file).mode & 0o077).toBe(0)
  } finally { fs.rmSync(directory,{recursive:true,force:true}) }
})
