import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const site = process.argv[2]
const mode = process.argv[3]
const isX = site === 'x'
const host = isX ? 'x.com' : 'linkedin.com'
const homeUrl = isX ? 'https://x.com/home' : 'https://www.linkedin.com/feed/'
const savedUrl = isX ? 'https://x.com/i/bookmarks' : 'https://www.linkedin.com/my-items/saved-posts/'
const command = process.env.BMUX_CLI
const statePath = join(homedir(), '.config', 'bmux', 'social-automation-state.json')
const now = () => Date.now()
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const between = (min, max) => min + Math.floor(Math.random() * (max - min + 1))
const choose = values => values[Math.floor(Math.random() * values.length)]

function call(method, args = {}) {
  const retryable = new Set(['eval', 'cdp', 'wait', 'click', 'type', 'key'])
  for (let attempt = 0; attempt < 3; attempt++) {
    const child = spawnSync(process.execPath, [command, 'plugin', 'host', method, '--stdin'], {
      input: JSON.stringify(args), encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024
    })
    if (child.error) throw child.error
    const response = JSON.parse(child.stdout || '{}')
    if (response.ok) return response.result
    const message = response.error || child.stderr?.trim() || `${method} failed`
    if (!retryable.has(method) || !/target document changed|execution context.*destroyed/i.test(message) || attempt === 2) throw new Error(message)
    spawnSync(process.execPath, [command, 'plugin', 'host', 'context', '--stdin'], {
      input: JSON.stringify({ refresh: true }), encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024
    })
  }
}

function defaultSiteState() {
  return { recentQueries: [], focused: 0, ambient: 0, lastLikeAt: null, nextLikeAfter: now() + between(2, 4) * 86400000, lastHumanInteractionAt: null }
}

function loadState() {
  let state = { linkedin: defaultSiteState(), x: defaultSiteState() }
  try { state = { ...state, ...JSON.parse(readFileSync(statePath, 'utf8')) } } catch {}
  state[site] = { ...defaultSiteState(), ...(state[site] || {}) }
  return state
}

function saveState(state) {
  mkdirSync(dirname(statePath), { recursive: true })
  const temporary = `${statePath}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, statePath)
}

function sameSite(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === host || url.hostname.endsWith(`.${host}`)) } catch { return false }
}

async function refresh(timeout = 30000) {
  const end = now() + timeout
  while (now() < end) {
    try {
      const context = call('context', { refresh: true })
      if (sameSite(context.url)) return context
    } catch {}
    await pause(800)
  }
  throw new Error(`Timed out waiting for ${host}`)
}

async function navigate(url) {
  if (!sameSite(url)) throw new Error(`Refusing navigation outside ${host}`)
  try {
    const current = call('context', { refresh: true })
    const existing = new URL(current.url)
    const target = new URL(url)
    if (existing.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '') && existing.search === target.search) {
      await pause(between(900, 1800))
      return current
    }
  } catch {}
  call('navigate', { url })
  const target = new URL(url)
  const end = now() + 30000
  let context = null
  while (now() < end) {
    try {
      const candidate = call('context', { refresh: true })
      const current = new URL(candidate.url)
      if (sameSite(candidate.url) && current.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '')) { context = candidate; break }
    } catch {}
    await pause(700)
  }
  if (!context) throw new Error(`Timed out navigating to ${target.pathname}`)
  await pause(between(1800, 4200))
  return context
}

function progress(percent, message) { call('progress', { percent, message }) }

async function wheel(direction = 1, small = false, smooth = false) {
  const amount = between(small ? 120 : 360, small ? 260 : 760) * direction
  call('context', { refresh: true })
  const x = between(420, 850), y = between(320, 650)
  if (smooth) {
    const steps = between(7, 12)
    let remaining = amount
    for (let step = 0; step < steps; step++) {
      const deltaY = step === steps - 1 ? remaining : Math.trunc(amount / steps)
      remaining -= deltaY
      call('cdp', { method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x, y, deltaX: 0, deltaY } })
      await pause(between(45, 110))
    }
  } else {
    call('cdp', { method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x, y, deltaX: 0, deltaY: amount } })
  }
  await pause(between(2400, 6200))
}

async function browseSurface(url, label, minScrolls = 2, maxScrolls = 4) {
  await navigate(url)
  const count = between(minScrolls, maxScrolls)
  const smoothIndex = between(0, Math.max(0, count - 1))
  for (let index = 0; index < count; index++) {
    await wheel(1, false, index === smoothIndex)
    if (index > 0 && Math.random() < 0.28) await wheel(-1, true, Math.random() < 0.5)
  }
  await pause(between(5000, 12000))
  return { surface: label, scrolls: count }
}

async function humanType(selector, value) {
  call('context', { refresh: true })
  call('click', { selector })
  const focused = call('eval', { expression: `document.activeElement === document.querySelector(${JSON.stringify(selector)})` })
  if (!focused) throw new Error('Could not focus the site search field')
  for (const type of ['keyDown', 'keyUp']) call('cdp', { method: 'Input.dispatchKeyEvent', params: { type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: process.platform === 'darwin' ? 4 : 2 } })
  for (const type of ['keyDown', 'keyUp']) call('cdp', { method: 'Input.dispatchKeyEvent', params: { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 } })
  await pause(between(400, 1100))
  for (const character of value) {
    call('cdp', { method: 'Input.insertText', params: { text: character } })
    await pause(between(45, 170))
  }
  await pause(between(1200, 2600))
}

async function search(query, resultLimit, warmupOnly = false) {
  await navigate(homeUrl)
  const expected = call('context').parameters?.expected_account_url
  if (isX && expected) {
    const handle = new URL(expected).pathname.toLowerCase()
    let actual, until = now() + 15000
    do {
      call('context', { refresh: true })
      actual = call('eval', { expression: `document.querySelector('a[data-testid="AppTabBar_Profile_Link"],a[aria-label="Profile"]')?.getAttribute('href')?.toLowerCase()` })
      if (actual) break
      await pause(500)
    } while (now() < until)
    if (actual !== handle) throw new Error('Signed in X account does not match the scheduled account')
  }
  const selector = isX ? 'input[data-testid="SearchBox_Search_Input"], input[aria-label="Search query"]' : 'input[placeholder*="Search" i]'
  call('wait', { selector, timeout: 30000 })
  await humanType(selector, query)
  const resultsUrl = isX
    ? `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`
    : `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}&origin=SWITCH_SEARCH_VERTICAL`
  await navigate(resultsUrl)
  const scrollCount = between(3, 5)
  const smoothIndex = between(0, scrollCount - 1)
  for (let index = 0; index < scrollCount; index++) await wheel(1, false, index === smoothIndex)
  if (warmupOnly) return []
  call('context', { refresh: true })
  const expression = isX
    ? `(() => [...document.querySelectorAll('article:not(article article)')].map(card => { const text = card.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || [...card.querySelectorAll('[dir="auto"]')].filter(el => el.closest('article') === card).map(el => el.innerText).join(' ').trim(); const url = card.querySelector('time')?.closest('a')?.href || [...card.querySelectorAll('a[href]')].find(a => a.closest('article') === card && /status/.test(a.href))?.href || ''; const author = card.querySelector('[data-testid="User-Name"]')?.innerText?.split('\\n')[0] || ''; return text && /\/status\//.test(url) ? { author, url, text: text.slice(0, 3000) } : null }).filter(Boolean).slice(0, ${resultLimit}))()`
    : `(() => { const selectors = 'article, [data-urn], [data-chameleon-result-urn], .feed-shared-update-v2, [data-view-name="search-entity-result-universal-template"], .search-results-container li, main li'; const cards = [...document.querySelectorAll(selectors)]; for (const button of document.querySelectorAll('button')) { const label = button.getAttribute('aria-label') || button.innerText || ''; if (!/^(react )?like(?:\\s|$)/i.test(label.trim())) continue; const card = button.closest('[data-urn], [data-chameleon-result-urn], article, li'); if (card) cards.push(card); } const seen = new Set(); const output = []; for (const card of cards) { const text = card.innerText?.trim() || ''; if (text.length < 40) continue; const links = [...card.querySelectorAll('a[href]')]; const link = links.find(item => /\\/(posts|feed\\/update)\\//.test(item.href)) || links.find(item => /activity[-/:]/.test(item.href)); const urn = card.getAttribute('data-urn') || card.getAttribute('data-chameleon-result-urn') || card.closest('[data-urn], [data-chameleon-result-urn]')?.getAttribute('data-urn') || card.closest('[data-chameleon-result-urn]')?.getAttribute('data-chameleon-result-urn'); const url = link?.href?.split('?')[0] || (urn?.includes('urn:li:activity:') ? 'https://www.linkedin.com/feed/update/' + urn + '/' : ''); if (!url || seen.has(url)) continue; seen.add(url); const author = card.querySelector('.update-components-actor__name, [data-view-name="feed-actor-image"] + *, [data-view-name="search-result-lockup-title"]')?.innerText?.trim().split('\\n')[0] || ''; output.push({ author, url, text: text.slice(0, 4000) }); if (output.length >= ${resultLimit}) break; } if (!output.length) { const text = document.querySelector('main')?.innerText?.trim() || ''; if (text.length > 80) output.push({ author: '', url: location.href, text: text.slice(0, 8000) }); } return output })()`
  return call('eval', { expression }) || []
}

async function maybeLike(query, siteState) {
  if (now() < Number(siteState.nextLikeAfter || 0)) return { liked: false, reason: 'not-due' }
  call('context', { refresh: true })
  const words = query.toLowerCase().split(/\s+/).filter(word => word.length >= 4).slice(0, 8)
  const expression = isX
    ? `(() => { const words = ${JSON.stringify(words)}; for (const card of document.querySelectorAll('article:not(article article)')) { const text = card.querySelector('[data-testid="tweetText"]')?.innerText?.toLowerCase() || ''; const button = card.querySelector('[data-testid="like"]'); const url = card.querySelector('time')?.closest('a')?.href; const rect = button?.getBoundingClientRect(); if (words.some(word => text.includes(word)) && url && rect?.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight) return { url, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; } return null })()`
    : `(() => { const words = ${JSON.stringify(words)}; for (const card of document.querySelectorAll('article, [data-urn], .feed-shared-update-v2')) { const text = card.innerText?.toLowerCase() || ''; const button = [...card.querySelectorAll('button')].find(item => /^(react )?like(?:\\s|$)/i.test(item.getAttribute('aria-label') || item.innerText?.trim() || '') && item.getAttribute('aria-pressed') !== 'true'); const url = card.querySelector('a[href*="/posts/"], a[href*="/feed/update/"]')?.href; const rect = button?.getBoundingClientRect(); if (words.some(word => text.includes(word)) && url && rect?.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight) return { url, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; } return null })()`
  const candidate = call('eval', { expression })
  if (!candidate || !sameSite(candidate.url)) return { liked: false, reason: 'no-relevant-visible-candidate' }
  try {
    call('automation.like', { url: candidate.url })
    for (const type of ['mousePressed', 'mouseReleased']) call('cdp', { method: 'Input.dispatchMouseEvent', params: { type, x: candidate.x, y: candidate.y, button: 'left', clickCount: 1 } })
    siteState.lastLikeAt = now()
    siteState.nextLikeAfter = now() + between(2, 4) * 86400000
    return { liked: true, url: candidate.url }
  } catch (error) {
    if (/disabled|daily cap/i.test(String(error.message))) return { liked: false, reason: 'policy-cap' }
    throw error
  }
}

function humanStatus(siteState) {
  const due = !siteState.lastHumanInteractionAt || now() - siteState.lastHumanInteractionAt >= 7 * 86400000
  return { due, lastAcknowledgedAt: siteState.lastHumanInteractionAt, reminder: due ? `Human interaction due: personally write one thoughtful ${isX ? 'reply' : 'comment'} this week, then run the record-human-interaction action.` : null }
}

async function warmup(siteState, targetQuery) {
  const activities = []
  const pool = ['feed', 'saved']
  if (siteState.recentQueries.some(query => query !== targetQuery)) pool.push('previous-search')
  const count = between(2, Math.min(3, pool.length))
  while (activities.length < count && pool.length) {
    const choice = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
    if (choice === 'feed') activities.push(await browseSurface(homeUrl, 'feed', 2, 4))
    if (choice === 'saved') activities.push(await browseSurface(savedUrl, 'saved', 1, 3))
    if (choice === 'previous-search') {
      const previous = choose(siteState.recentQueries.filter(query => query !== targetQuery))
      await search(previous, 3, true)
      activities.push({ surface: 'previous-search', query: previous })
    }
    siteState.ambient++
  }
  return activities
}

async function main() {
  if (!['linkedin', 'x'].includes(site)) throw new Error('Unsupported site')
  const context = call('context')
  const parameters = context.parameters || {}
  const state = loadState()
  const siteState = state[site]
  const query = String(parameters.query || '').trim()
  const resultLimit = Math.min(20, Math.max(3, Number(parameters.result_limit || 10)))
  const leaseUrl = sameSite(context.url) ? context.url : homeUrl
  call('automation.acquire', { url: leaseUrl })

  if (mode === 'record-human') {
    siteState.lastHumanInteractionAt = now()
    saveState(state)
    call('result', { site, recordedAt: new Date(siteState.lastHumanInteractionAt).toISOString(), humanInteraction: humanStatus(siteState) })
    return
  }

  if (mode === 'feed') {
    const activity = await browseSurface(homeUrl, 'feed', 3, 6)
    siteState.ambient++
    saveState(state)
    call('result', { site, activity, humanInteraction: humanStatus(siteState) })
    return
  }

  if (mode === 'saved') {
    const activity = await browseSurface(savedUrl, 'saved', 2, 5)
    siteState.ambient++
    saveState(state)
    call('result', { site, activity, humanInteraction: humanStatus(siteState) })
    return
  }

  if (!query || query.length < 3 || query.length > 512) throw new Error('Query must be 3–512 characters')
  let warmupActivities = []
  if (mode === 'research') {
    progress(5, 'Starting randomized warm-up')
    warmupActivities = await warmup(siteState, query)
  }
  progress(55, `Searching ${site === 'linkedin' ? 'LinkedIn posts' : 'X posts'}`)
  const results = await search(query, resultLimit)
  siteState.focused++
  siteState.recentQueries = [query, ...siteState.recentQueries.filter(item => item !== query)].slice(0, 8)
  const like = null // Browsing personas own social interactions.
  let cooldown = null
  const ratio = siteState.focused / Math.max(1, siteState.ambient)
  if (mode === 'research' && (ratio >= 1.5 || Math.random() < 0.35)) {
    progress(88, 'Cooling down on the main feed')
    cooldown = await browseSurface(homeUrl, 'feed-cooldown', 2, 4)
    siteState.ambient++
  }
  saveState(state)
  call('result', {
    site, query, results, resultCount: results.length, warmup: warmupActivities, cooldown, like,
    pacing: { focused: siteState.focused, ambient: siteState.ambient, ratio: Number((siteState.focused / Math.max(1, siteState.ambient)).toFixed(2)), nextLikeEligibleAt: new Date(siteState.nextLikeAfter).toISOString() },
    humanInteraction: humanStatus(siteState)
  })
}

main().catch(error => {
  try { call('result', { site, mode, error: String(error?.message || error) }) } catch {}
  process.exitCode = 1
})
