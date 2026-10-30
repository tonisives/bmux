import { test, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createActivity } from '../src/main/activity'
test('one episode spans panes and pending operations, ends after idle, and replays until acknowledged', () => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-activity-')), time = 0
  try {
    let file = path.join(dir, 'activity.json'), activity = createActivity(file, () => time)
    let target = { sessionId: 's', paneId: 'p', profileId: 'profile', agentId: 'agent' }
    let done = activity.begin(target, 'navigate'); time = 60000; activity.tick()
    expect(activity.episodes()[0].endedAt).toBeUndefined()
    done(); done(); let other = activity.begin({ ...target, paneId: 'other' }, 'click'); other()
    expect(activity.events().filter(e => e.type === 'agent.session.start')).toHaveLength(1)
    time += 29999; activity.tick(); expect(activity.episodes()[0].endedAt).toBeUndefined()
    time++; activity.tick(); expect(activity.episodes()[0].reason).toBe('idle')
    let replay = createActivity(file, () => time)
    expect(replay.events()).toEqual(activity.events())
    for (let event of replay.events()) replay.acknowledge(event.id)
    expect(replay.events()).toEqual([])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})


test('host restart ends outstanding episodes once while retaining their original profile and replay',()=>{
  let dir=fs.mkdtempSync(path.join(os.tmpdir(),'bmux-activity-'))
  try{
    let file=path.join(dir,'activity.json'),activity=createActivity(file,()=>1000)
    activity.begin({sessionId:'s',paneId:'p',profileId:'profile',agentId:'agent'},'plugin.run')
    let restored=createActivity(file,()=>2000),ended=restored.events().filter(event=>event.type==='agent.session.end')
    expect(ended).toHaveLength(1);expect(ended[0]).toMatchObject({reason:'host-restarted',target:{profileId:'profile'}})
    expect(restored.episodes()[0].pending).toBe(0)
    expect(createActivity(file,()=>3000).events()).toEqual(restored.events())
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
