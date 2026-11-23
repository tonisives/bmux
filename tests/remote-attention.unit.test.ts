import { it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
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

it('stores the acknowledgement before waking the originator and keeps failed verification paused', async () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(),'bmux-attention-test-')), file = path.join(directory,'attention.json')
  try {
    let ledger = createAttentionRequests(file), event = ledger.request('pane','session','episode','agent'), request = randomUUID()
    let waiting = ledger.wait(event.episode,'agent').then(ack => {
      let stored = JSON.parse(fs.readFileSync(file,'utf8'))
      expect(stored[0].attempts.at(-1).id).toBe(ack.attemptId)
      expect(stored[0].status).toBe('verifying')
      return ack
    })
    let ack = ledger.acknowledge('pane','episode',event.revision,request)
    expect(await waiting).toEqual(ack)
    expect(ledger.receipt('pane','episode',request)).toEqual(ack)
    expect(() => ledger.assert('pane')).toThrow('paused')
    expect(() => ledger.verify('pane','episode',ack.attemptId,'different-agent','verified')).toThrow('ATTENTION_CHANGED')
    let failed = ledger.verify('pane','episode',ack.attemptId,'agent','verification-failed','CHALLENGE_REMAINS')
    expect(failed.status).toBe('pending')
    expect(() => ledger.assert('pane')).toThrow('paused')
    expect(ledger.acknowledge('pane','episode',event.revision,request)).toEqual(ack)
    expect(() => ledger.acknowledge('pane','episode',event.revision,randomUUID())).toThrow('ATTENTION_CHANGED')
    let second = ledger.acknowledge('pane','episode',failed.revision,randomUUID())
    expect(() => ledger.verify('pane','episode',ack.attemptId,'agent','verified')).toThrow('ATTENTION_CHANGED')
    ledger.verify('pane','episode',second.attemptId,'agent','verified')
    expect(() => ledger.assert('pane')).not.toThrow()
    expect(ledger.verify('pane','episode',second.attemptId,'agent','verified').status).toBe('resolved')
  } finally { fs.rmSync(directory,{recursive:true,force:true}) }
})

it('recovers an interrupted verification as paused and rejects writes when durability fails', async () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(),'bmux-attention-test-')), file = path.join(directory,'attention.json')
  try {
    let ledger = createAttentionRequests(file), event = ledger.request('pane','session','episode','agent')
    ledger.acknowledge('pane','episode',event.revision,randomUUID())
    let restored = createAttentionRequests(file), pending = restored.active()[0]
    expect(pending.status).toBe('pending')
    expect(pending.attempts.at(-1)?.outcome).toBe('verification-timeout')
    expect(() => restored.assert('pane')).toThrow('paused')
    fs.mkdirSync(`${file}.tmp`)
    expect(() => restored.acknowledge('pane','episode',pending.revision,randomUUID())).toThrow()
    expect(() => restored.assert('pane')).toThrow('unreadable')
    expect(JSON.parse(fs.readFileSync(file,'utf8'))[0].status).toBe('pending')
  } finally { fs.rmSync(directory,{recursive:true,force:true}) }
})

it('completes a checked browser warning even when the recorded plugin has ended', () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(),'bmux-attention-test-')), file = path.join(directory,'attention.json')
  try {
    let ledger = createAttentionRequests(file)
    let warning = ledger.request('pane','session','warning','plugin:bmux.x','account-warning')
    let legacy = ledger.request('other-pane','session','legacy','plugin:bmux.x','challenge')
    ledger = createAttentionRequests(file)
    expect(() => ledger.assert(warning.pane)).toThrow('paused')
    let request = randomUUID()
    let acknowledgement = ledger.acknowledge(warning.pane,warning.episode,warning.revision,request)
    let restored = createAttentionRequests(file)
    expect(restored.receipt(warning.pane,warning.episode,request)).toEqual(acknowledgement)
    expect(restored.all()[0]).toMatchObject({ originator: 'plugin:bmux.x', status: 'resolved', attempts: [{ outcome: 'verified' }] })
    expect(() => restored.assert(warning.pane)).not.toThrow()
    restored.resolve(legacy.pane,legacy.episode)
    expect(restored.active()).toEqual([])
  } finally { fs.rmSync(directory,{recursive:true,force:true}) }
})

it('cancels a removed exact target without resolving another pane', async () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(),'bmux-attention-test-'))
  try {
    let ledger = createAttentionRequests(path.join(directory,'attention.json'))
    ledger.request('one','session','first'); ledger.request('two','session','second')
    ledger.cancelMissing(new Set(['two']))
    expect(ledger.all()[0].status).toBe('cancelled')
    expect(ledger.active().map(item => item.pane)).toEqual(['two'])
  } finally { fs.rmSync(directory,{recursive:true,force:true}) }
})
