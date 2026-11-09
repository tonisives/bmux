import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { captureViewportScreenshot } from './viewport-screenshot'

let defaultRoot = '/Volumes/sam/app-support/bmux/browse-history/local'
let hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
let read = async (file: string, fallback: any) => { try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error } }
let write = async (file: string, value: string | Buffer) => { let temporary = file + '.' + randomUUID(); await fs.writeFile(temporary, value, { mode: 0o600 }); await fs.rename(temporary, file) }
export let createBrowseRecorder = (options: { directory?: string; mount?: string; captureTimeoutMs?: number } = {}) => {
  let root = options.directory ?? defaultRoot, mount = options.mount ?? (options.directory ? undefined : '/Volumes/sam')
  let error: string | undefined, queue = Promise.resolve<unknown>(undefined), seen = new Map<string, string>()
  let capturing = new WeakSet<WebContents>()
  let store = (state: any, image: any, context: any) => {
    let operation = queue.catch(() => undefined).then(async () => {
      let platform = context.platform, mode = context.mode === 'manual' ? 'manual' : 'automation'
      if (!['x', 'tiktok', 'instagram', 'youtube', 'linkedin', 'threads', 'bluesky', 'mastodon'].includes(platform) || !state?.ok || typeof state.identity !== 'string' || image?.format !== 'jpeg') throw new Error('Invalid social capture')
      let bytes = Buffer.from(image.data, 'base64')
      if (bytes.length > 4 * 1024 * 1024 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Invalid capture image')
      if (mount && (await fs.stat(mount)).dev === (await fs.stat(path.dirname(mount))).dev) throw new Error('Recording volume is unavailable')
      let identity = state.postURL || state.identity
      if (platform === 'x') { let id = identity.match(/\/(?:status|article)\/(\d+)/)?.[1]; if (id) identity = 'https://x.com/i/status/' + id }
      let itemKey = hash(platform + ':' + identity), key = mode + ':' + itemKey, signature = hash(JSON.stringify([state.historyText || state.text, context.profileId, context.session]))
      if (seen.get(key) === signature) return { status: 'unchanged' }
      await fs.mkdir(path.join(root, '.state'), { recursive: true, mode: 0o700 })
      let indexFile = path.join(root, '.state', 'index.json'), index = await read(indexFile, {})
      let observedAt = new Date().toISOString(), relative = index[key] || path.join(mode, 'social-media', platform, observedAt.replace(/:/g, '-') + '--' + itemKey)
      let directory = path.join(root, relative), images = path.join(directory, 'images')
      await fs.mkdir(images, { recursive: true, mode: 0o700 })
      let checksum = hash(bytes), data = await read(path.join(directory, 'post.json'), { version: 1, itemKey, observations: [] })
      let observation = { eventId: randomUUID(), observedAt, origin: 'local', platform, ...context, mode, identity: state.identity, url: state.postURL || null, author: state.author || state.creator || null, publishedAt: state.publishedAt || null, text: state.historyText || state.text || '', sponsored: !!state.sponsored, engagement: state.engagement || [], contentType: state.contentType, context: state.context || null, xPost: state.xPost || null, image: { path: `images/${checksum}.jpg`, sha256: checksum, postOnly: image.postOnly === true, width: image.width, height: image.height, clip: image.clip, viewport: image.viewport } }
      let accounts = options.directory ? {} : await read(path.join(process.env.HOME || '', '.local/state/browser-simulations/browse-history.json'), {})
      let account = accounts.profiles?.[context.profileId]
      if (account) Object.assign(observation, { account: { id: account.id, name: account.name, profileId: context.profileId } })
      data.observations.push(observation); Object.assign(data, observation)
      await write(path.join(images, checksum + '.jpg'), bytes)
      await write(path.join(directory, 'post.jpg'), bytes)
      await write(path.join(directory, 'post.json'), JSON.stringify(data, null, 2) + '\n')
      await write(path.join(directory, 'post.md'), [observation.url || observation.identity, JSON.stringify(observation.author), `Observed: ${observedAt}`, observation.text, '![Observed post](post.jpg)'].filter(Boolean).join('\n\n') + '\n')
      index[key] = relative; await write(indexFile, JSON.stringify(index, null, 2) + '\n')
      seen.set(key, signature); if (seen.size > 10000) seen.delete(seen.keys().next().value!)
      error = undefined
      return { status: 'stored', itemKey }
    })
    queue = operation
    return operation.catch(failure => { error = failure.message; throw failure })
  }
  let capture = async (contents: WebContents, plugins: string, context: any, enabled: () => boolean) => {
    // A renderer or native screenshot may never settle. Keep that pane's request
    // single-flight while allowing the runtime to move on to other pages.
    if (capturing.has(contents)) return
    capturing.add(contents)
    let expired = false, timer: ReturnType<typeof setTimeout> | undefined
    let active = () => !expired && enabled()
    let operation = (async () => {
      try {
        let url = new URL(contents.getURL())
        for (let platform of ['x', 'tiktok', 'instagram', 'youtube', 'linkedin', 'threads', 'bluesky', 'mastodon']) {
          let contribution = await read(path.join(plugins, 'bmux.' + platform, 'simulation', 'capture.json'), null)
          if (!active()) return
          if (!contribution || !contribution.hosts.some((host: string) => url.hostname === host || url.hostname.endsWith('.' + host))) continue
          let before = await contents.executeJavaScript(contribution.expression)
          if (!before?.ok || !active()) return
          if (!before.cardRect || !before.viewport) return
          let image = await captureViewportScreenshot(contents, { clip: before.cardRect, viewport: before.viewport, format: 'jpeg', quality: 85, maxDimension: 1024 })
          if (!active()) return
          let after = await contents.executeJavaScript(contribution.expression)
          if (!active() || !after?.ok || before.identity !== after.identity || before.text !== after.text || JSON.stringify(before.cardRect) !== JSON.stringify(after.cardRect) || JSON.stringify(before.viewport) !== JSON.stringify(after.viewport)) return
          await store(after, { ...image, data: image.data.toString('base64') }, { ...context, platform })
          return
        }
      } finally { capturing.delete(contents) }
    })()
    try {
      await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new Error('Browse capture timed out')) }, options.captureTimeoutMs ?? 3000)
      })])
    } catch (failure) { error = (failure as Error).message }
    finally { clearTimeout(timer) }
  }
  return { store, capture, get error() { return error } }
}
