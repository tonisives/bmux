import fs from 'node:fs/promises'
import path from 'node:path'
import { writeAtomic } from './store'

export type RedditReadLedger = { name: string; data: string }

let ledgerName = /^[a-z0-9_-]{3,32}-daily\.json$/
let profileName = /^profile_[a-zA-Z0-9_-]+$/

export let readRedditLedgers = async (directory: string, profile: string): Promise<RedditReadLedger[]> => {
  if (!profileName.test(profile)) throw new Error('ACCOUNT_PROFILE_INVALID')
  let root = path.join(directory, 'reddit-research')
  let names: string[]
  try { names = await fs.readdir(root) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  let prefix = profile + '-'
  return Promise.all(names.filter(name => name.startsWith(prefix) && ledgerName.test(name.slice(prefix.length))).map(async name => ({
    name: name.slice(prefix.length),
    data: await fs.readFile(path.join(root, name), 'utf8'),
  })))
}

export let writeRedditLedgers = (directory: string, profile: string, ledgers: RedditReadLedger[]) => {
  if (!profileName.test(profile) || !Array.isArray(ledgers) || ledgers.length > 100 || ledgers.some(ledger =>
    !ledger || typeof ledger.name !== 'string' || !ledgerName.test(ledger.name) || typeof ledger.data !== 'string' || Buffer.byteLength(ledger.data) > 1_000_000
  )) throw new Error('ACCOUNT_REDDIT_LEDGER_INVALID')
  for (let ledger of ledgers) {
    let value = JSON.parse(ledger.data)
    if (!value || typeof value.day !== 'string' || !value.communities || !Object.values(value.communities).every(ids =>
      Array.isArray(ids) && ids.every(id => typeof id === 'string')
    )) throw new Error('ACCOUNT_REDDIT_LEDGER_INVALID')
    writeAtomic(path.join(directory, 'reddit-research', profile + '-' + ledger.name), ledger.data)
  }
}
