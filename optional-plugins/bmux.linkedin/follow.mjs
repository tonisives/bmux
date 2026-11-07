import { spawnSync } from 'node:child_process'

let site = process.argv[2]
let host = { x: 'x.com', linkedin: 'linkedin.com', reddit: 'reddit.com' }[site]
if (!host) throw new Error('Choose X, LinkedIn, or Reddit')
let call = (method, args = {}) => {
  let child = spawnSync(process.execPath, [process.env.BMUX_CLI, 'plugin', 'host', method, '--stdin'], { input: JSON.stringify(args), encoding: 'utf8', timeout: 65000, maxBuffer: 1024 * 1024 })
  if (child.error) throw child.error
  let response = JSON.parse(child.stdout || '{}')
  if (!response.ok) throw new Error(response.error || `${method} failed`)
  return response.result
}
let pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let profileUrl = value => {
  let url = new URL(value)
  let validPath = site === 'x' ? /^\/[a-z0-9_]{1,15}\/?$/i.test(url.pathname) && !/^\/(home|search|explore|notifications|messages|settings|compose|login|logout|signup|intent|i)\/?$/i.test(url.pathname) : site === 'linkedin' ? /^\/in\/[a-z0-9_-]+\/?$/i.test(url.pathname) : /^\/(user|u)\/[a-z0-9_-]+\/?$/i.test(url.pathname)
  if (url.protocol !== 'https:' || ![host, `www.${host}`].includes(url.hostname) || url.username || url.password || url.port || !validPath) throw new Error(`Supply HTTPS ${host} profile URLs`)
  return `https://${host}${url.pathname.replace(/\/$/, '').replace(/^\/u\//, '/user/').toLowerCase()}`
}
let urls = JSON.parse(call('context').parameters.urls)
if (!Array.isArray(urls) || !urls.length || urls.length > 10 || urls.some(url => typeof url !== 'string')) throw new Error('Supply 1–10 profile URLs')
urls = [...new Set(urls.map(profileUrl))]
call('automation.acquire', { url: urls[0] })
let reserved = 0, followed = 0, skipped = 0, capped = false
// Restrict each lookup to the profile header, excluding recommendations and feed cards.
let expression = `(() => {
  let site = ${JSON.stringify(site)};
  let root = site === 'x' ? document.querySelector('[data-testid="primaryColumn"]') : site === 'linkedin' ? document.querySelector('main h1')?.closest('section') : document.querySelector('shreddit-profile-header, reddit-user-header, main header');
  if (!root) return null;
  let tabs = site === 'x' ? root.querySelector('[role="tablist"]') : null;
  if (site === 'x' && !tabs) return null;
  let buttons = [...root.querySelectorAll('button')].filter(button => !button.closest('article') && (!tabs || Boolean(button.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING)));
  let label = button => (button.getAttribute('aria-label') || button.innerText || '').trim();
  if (buttons.some(button => /^(following|unfollow)(?:\\s|$)/i.test(label(button)) || /-unfollow$/.test(button.getAttribute('data-testid') || ''))) return { following: true };
  let button = buttons.find(button => !button.disabled && button.getAttribute('aria-pressed') !== 'true' && (site === 'x' ? /-follow$/.test(button.getAttribute('data-testid') || '') : /^follow(?:\\s+.+)?$/i.test(label(button))));
  let r = button?.getBoundingClientRect();
  if (!r || r.width <= 0 || r.height <= 0 || r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) return null;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`
let atTarget = target => {
  let current = call('context', { refresh: true })
  try { return profileUrl(current.url) === target } catch { return false }
}
for (let target of urls) {
  call('navigate', { url: target })
  let end = Date.now() + 30000, candidate = null
  while (Date.now() < end) {
    if (atTarget(target)) candidate = call('eval', { expression })
    if (candidate) break
    await pause(1000)
  }
  if (!candidate) throw new Error(`Could not find the profile follow control: ${target}`)
  if (candidate.following) { skipped++; continue }
  await pause(3000 + Math.floor(Math.random() * 5000))
  if (!atTarget(target)) throw new Error('Profile changed before following')
  candidate = call('eval', { expression })
  if (!candidate) throw new Error('Profile follow control changed')
  if (candidate.following) { skipped++; continue }
  try {
    call('automation.follow', { url: target })
  } catch (error) {
    if (String(error.message).includes('Weekly follow cap reached')) { capped = true; break }
    if (String(error.message).includes('Profile already reserved for follow this week')) { skipped++; continue }
    throw error
  }
  reserved++
  for (let type of ['mousePressed', 'mouseReleased']) call('cdp', { method: 'Input.dispatchMouseEvent', params: { type, x: candidate.x, y: candidate.y, button: 'left', clickCount: 1 } })
  end = Date.now() + 10000
  let confirmed = false
  while (Date.now() < end) {
    if (!atTarget(target)) break
    if (call('eval', { expression })?.following) { confirmed = true; break }
    await pause(1000)
  }
  if (!confirmed) throw new Error(`Follow was not confirmed; weekly attempt counted: ${target}`)
  followed++
  call('progress', { percent: Math.round((followed + skipped) / urls.length * 100), message: `Followed ${followed} of ${urls.length}` })
}
call('result', { followed, reserved, skipped, capped })
