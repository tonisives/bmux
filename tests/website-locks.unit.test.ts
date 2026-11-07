import { expect, test } from 'vitest'
import { createWebsiteLocks } from '../src/main/website-locks'

test('a run owns its website across commands and panes, independently of other profiles', () => {
  let locks = createWebsiteLocks()
  locks.claim('one', ['https://www.x.com/feed'], 'run-1')
  locks.assertAvailable('one', ['http://x.com:8080/thread'], 'run-1')
  expect(() => locks.assertAvailable('one', ['https://x.com/'], 'run-2')).toThrow('Website is busy')
  expect(() => locks.assertAvailable('one', ['https://x.com/'])).toThrow('Website is busy')
  locks.claim('two', ['https://x.com/'], 'run-2')
  locks.claim('one', ['https://linkedin.com/'], 'run-3')
  locks.release('run-1')
  locks.assertAvailable('one', ['https://x.com/'], 'run-4')
  expect(() => locks.assertAvailable('two', ['https://x.com/'], 'run-4')).toThrow('Website is busy')
})

test('navigation claims both websites atomically and a completed run releases all of them', () => {
  let locks = createWebsiteLocks()
  locks.claim('one', ['https://destination.com/'], 'other')
  expect(() => locks.claim('one', ['https://source.com/', 'https://destination.com/'], 'run')).toThrow('Website is busy')
  locks.claim('one', ['https://source.com/'], 'new')
  locks.release('other'); locks.release('new')
  locks.claim('one', ['https://source.com/', 'https://destination.com/'], 'run')
  locks.release('run')
  locks.assertAvailable('one', ['https://source.com/', 'https://destination.com/'])
})
