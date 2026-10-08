import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let exec = promisify(execFile)
test('article pages render at desktop and mobile widths with playable CDN videos', async () => {
  if (process.env.BMUX_TEST_NATIVE !== '1') throw new Error('Run through Tart')
  let root = process.cwd(), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-article-qa-'))
  let destination = path.join(root, 'artifacts/article-pages')
  await fs.mkdir(destination, { recursive: true })
  let server = http.createServer(async (request, response) => {
    try {
      let pathname = new URL(request.url!, 'http://fixture').pathname
      let relative = pathname.endsWith('/') ? pathname + 'index.html' : pathname
      let file = path.join(root, 'article-site', relative)
      if (!file.startsWith(path.join(root, 'article-site') + path.sep)) throw new Error('Invalid path')
      let mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.vtt': 'text/vtt', '.png': 'image/png' }
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); response.end(await fs.readFile(file))
    } catch { response.writeHead(404); response.end('Missing') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let app = await electron.launch({ args: [root], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  let cli = async (method: string, args: Record<string, unknown> = {}) => {
    let result = await exec(process.execPath, [path.join(root, 'bin/bmux.mjs'), 'rpc', method, JSON.stringify(args)], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 30000 })
    let data = JSON.parse(result.stdout); if (!data.ok) throw new Error(data.error); return data.result
  }
  try {
    await expect.poll(() => app.context().pages().length).toBeGreaterThan(0)
    let state = await cli('state'), pane = state.model.sessions[0].windows[0].panes[0].id
    let indexTarget = `${url}/articles/`
    await cli('navigate', { pane, url: indexTarget }); await cli('wait', { pane, selector: 'main img' })
    let indexPage = app.context().pages().find(page => page.url() === indexTarget)!
    let indexErrors: string[] = []; indexPage.on('pageerror', error => indexErrors.push(error.message))
    expect(await indexPage.locator('main article img').count()).toBe(6)
    await indexPage.evaluate(() => { for (let image of document.images) image.loading = 'eager' })
    await expect.poll(() => indexPage.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)), { timeout: 30000 }).toBe(true)
    for (let width of [1200, 390]) {
      await cli('cdp', { pane, method: 'Emulation.setDeviceMetricsOverride', params: { width, height: 844, deviceScaleFactor: 1, mobile: false } })
      await expect.poll(() => indexPage.evaluate(() => innerWidth)).toBe(width)
      expect(await indexPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await indexPage.screenshot({ path: path.join(destination, `index-${width}.png`), fullPage: true })
    }
    expect(indexErrors).toEqual([])
    console.log('Verified article index: six CDN hero images, desktop and mobile layout')
    await cli('cdp', { pane, method: 'Emulation.clearDeviceMetricsOverride' })
    for (let slug of ['social-media-scheduling', 'floating-panes', 'click-mode', 'profile-proxies', 'bookmarks', 'vim-navigation']) {
      let target = `${url}/articles/${slug}/`
      await cli('navigate', { pane, url: target }); await cli('wait', { pane, selector: 'h1' })
      let page = app.context().pages().find(page => page.url() === target)!
      let errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
      await page.evaluate(() => { for (let image of document.images) image.loading = 'eager'; document.querySelector('video')?.load() })
      await expect.poll(() => page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)), { timeout: 30000 }).toBe(true)
      if (await page.locator('video').count()) {
      await expect.poll(() => page.evaluate(() => document.querySelector('video')!.videoWidth), { timeout: 30000 }).toBe(1200)
      await expect.poll(() => page.evaluate(() => document.querySelector('track')!.readyState), { timeout: 15000 }).toBe(2)
      }
      for (let width of [1200, 390]) {
        await cli('cdp', { pane, method: 'Emulation.setDeviceMetricsOverride', params: { width, height: 844, deviceScaleFactor: 1, mobile: false } })
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
        await page.evaluate(() => scrollTo(0, 0))
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: path.join(destination, `${slug}-${width}.png`), fullPage: true })
      }
      if (slug === 'social-media-scheduling') {
        await page.locator('img[src$="flow.svg"]').screenshot({ path: path.join(destination, 'social-flow.png') })
        await page.locator('img[src$="routes.svg"]').screenshot({ path: path.join(destination, 'social-routes.png') })
      }
      expect(errors).toEqual([])
      console.log(`Verified ${slug}: CDN images, available video/captions, desktop and mobile layout`)
      await cli('cdp', { pane, method: 'Emulation.clearDeviceMetricsOverride' })
    }
  } finally {
    await app.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true })
  }
})
