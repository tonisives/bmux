import { spawnSync } from 'node:child_process'

let site = process.argv[2]
let host = site === 'x' ? 'x.com' : 'linkedin.com'
let command = process.env.BMUX_CLI
let call = (method, args = {}) => {
  let child = spawnSync(command, ['plugin', 'host', method, '--stdin'], { input: JSON.stringify(args), encoding: 'utf8', timeout: 65000, maxBuffer: 1024 * 1024 })
  if (child.error) throw child.error
  let response = JSON.parse(child.stdout || '{}')
  if (!response.ok) throw new Error(response.error || `${method} failed`)
  return response.result
}
let pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let between = (min, max) => min + Math.floor(Math.random() * (max - min + 1))
let sameSite = value => {
  let url = new URL(value)
  return url.protocol === 'https:' && (url.hostname === host || url.hostname.endsWith(`.${host}`))
}
let atTarget = (current, target) => {
  try { let a = new URL(current), b = new URL(target); return sameSite(current) && sameSite(target) && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '') && (b.pathname === '/search' ? a.search === b.search : true) } catch { return false }
}
let waitForTarget = async (target, timeout) => {
  let end = Date.now() + timeout
  while (Date.now() < end) {
    let current = call('context', { refresh: true })
    if (atTarget(current.url, target)) return current
    await pause(1000)
  }
  return null
}
let context = call('context')
let urls = JSON.parse(context.parameters.urls)
let topic = String(context.parameters.topic).trim()
if (!Array.isArray(urls) || !urls.length || urls.length > 20 || urls.some(url => typeof url !== 'string' || !sameSite(url)) || topic.length < 3 || topic.length > 160) throw new Error('Supply 1–20 HTTPS site URLs and a topic phrase')
call('automation.acquire', { url: urls[0] })
let visited = 0, liked = 0
for (let target of urls) {
  let current = call('context', { refresh: true })
  let link = current.url && sameSite(current.url) ? call('eval', { expression: `(() => { let target = ${JSON.stringify(target)}; let link = [...document.querySelectorAll('a[href]')].find(a => { if (a.href !== target) return false; let r=a.getBoundingClientRect(); return r.width>0 && r.height>0 && r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight; }); if (!link) return null; let r = link.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()` }) : null
  if (link) {
    for (let type of ['mousePressed', 'mouseReleased']) call('cdp', { method: 'Input.dispatchMouseEvent', params: { type, x: link.x, y: link.y, button: 'left', clickCount: 1 } })
    current = await waitForTarget(target, 10000)
  }
  if (!current || !atTarget(current.url, target)) {
    call('navigate', { url: target })
    current = await waitForTarget(target, 30000)
  }
  if (!current) throw new Error('Timed out waiting for the requested page')
  if (!sameSite(current.url)) throw new Error('Navigation left the configured site')
  visited++
  call('progress', { percent: Math.round(visited / urls.length * 100), message: `Visited ${visited} of ${urls.length}` })
  let scrolls = between(1, 3)
  for (let index = 0; index < scrolls; index++) {
    await pause(between(3000, 8000))
    call('cdp', { method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: 600, y: 500, deltaX: 0, deltaY: between(260, 650) } })
  }
  await pause(between(15000, 45000))
  let expression = site === 'x' ? `(() => { let phrase = ${JSON.stringify(topic.toLowerCase())}; for (let card of document.querySelectorAll('article[data-testid="tweet"]')) { let body = card.querySelector('[data-testid="tweetText"]')?.innerText?.toLowerCase() ?? ''; let button = card.querySelector('[data-testid="like"]'); let link = card.querySelector('time')?.closest('a')?.href; let r = button?.getBoundingClientRect(); if (body.includes(phrase) && r?.width>0 && r.height>0 && r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight && link?.includes('/status/')) return { url: link, x: r.x+r.width/2, y: r.y+r.height/2 }; } return null })()` : `(() => { let phrase = ${JSON.stringify(topic.toLowerCase())}; for (let card of document.querySelectorAll('[data-urn]')) { let body = card.innerText?.toLowerCase() ?? ''; let button = [...card.querySelectorAll('button')].find(item => /^(react )?like(?:\\s|$)/i.test(item.getAttribute('aria-label') ?? item.innerText?.trim() ?? '') && item.getAttribute('aria-pressed') !== 'true'); let link = card.querySelector('a[href*="/feed/update/"]')?.href; let r = button?.getBoundingClientRect(); if (body.includes(phrase) && r?.width>0 && r.height>0 && r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight && link) return { url: link, x: r.x+r.width/2, y: r.y+r.height/2 }; } return null })()`
  let candidate = call('eval', { expression })
  if (candidate && sameSite(candidate.url)) {
    try {
      call('automation.like', { url: candidate.url })
      for (let type of ['mousePressed', 'mouseReleased']) call('cdp', { method: 'Input.dispatchMouseEvent', params: { type, x: candidate.x, y: candidate.y, button: 'left', clickCount: 1 } })
      liked++
    } catch (error) {
      if (!String(error.message).includes('Likes are disabled or at the daily cap')) throw error
    }
  }
}
call('result', { visited, liked })
