import { spawnSync } from 'node:child_process'

let command = process.env.BMUX_CLI
let call = (method, args = {}) => {
  let child = spawnSync(process.execPath, [command, 'plugin', 'host', method, '--stdin'], { input: JSON.stringify(args), encoding: 'utf8', timeout: 65000, maxBuffer: 1024 * 1024 })
  if (child.error) throw child.error
  let response = JSON.parse(child.stdout || '{}')
  if (!response.ok) throw new Error(response.error || `${method} failed`)
  return response.result
}
let pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let sameSite = value => {
  try {
    let url = new URL(value)
    return url.protocol === 'https:' && ['reddit.com', 'www.reddit.com', 'old.reddit.com'].includes(url.hostname)
  } catch { return false }
}
let atTarget = (current, target) => {
  try {
    let a = new URL(current), b = new URL(target)
    return sameSite(current) && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '') && [...b.searchParams].every(([key, value]) => a.searchParams.get(key) === value)
  } catch { return false }
}
let waitForTarget = async target => {
  let end = Date.now() + 30000
  while (Date.now() < end) {
    let current = call('context', { refresh: true })
    if (atTarget(current.url, target)) return current
    await pause(500)
  }
  throw new Error('Timed out waiting for the requested Reddit page')
}

let context = call('context')
let urls = JSON.parse(context.parameters.urls)
if (!Array.isArray(urls) || !urls.length || urls.length > 10 || urls.some(url => typeof url !== 'string' || !sameSite(url))) throw new Error('Supply 1–10 HTTPS Reddit URLs')
call('automation.acquire', { url: urls[0] })
let visited = 0, clicked = 0
for (let target of urls) {
  let current = call('context', { refresh: true })
  if (!atTarget(current.url, target)) {
    let link = current.url && sameSite(current.url) ? call('eval', { expression: `(() => { let target = ${JSON.stringify(target)}; let link = [...document.querySelectorAll('a[href]')].find(a => { if (a.href !== target) return false; let r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0 }); if (!link) return null; link.scrollIntoView({ block: 'center' }); let r = link.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()` }) : null
    if (link) {
      for (let type of ['mousePressed', 'mouseReleased']) call('cdp', { method: 'Input.dispatchMouseEvent', params: { type, x: link.x, y: link.y, button: 'left', clickCount: 1 } })
      try { current = await waitForTarget(target); clicked++ } catch { current = null }
    }
    if (!current || !atTarget(current.url, target)) {
      call('navigate', { url: target })
      current = await waitForTarget(target)
    }
  }
  if (!sameSite(current.url)) throw new Error('Navigation left Reddit')
  visited++
  call('progress', { percent: Math.round(visited / urls.length * 100), message: `Visited ${visited} of ${urls.length}` })
  await pause(1200)
  let point = call('eval', { expression: '({ x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) })' })
  call('cdp', { method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', ...point, deltaX: 0, deltaY: 360 } })
  await pause(1500)
}
call('result', { visited, clicked })
