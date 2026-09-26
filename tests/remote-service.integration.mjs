import assert from 'node:assert/strict'
import { createHash, randomBytes, generateKeyPairSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { Pool } from 'pg'
import { WebSocket } from 'ws'
import fs from 'node:fs/promises'

let url = process.env.BMUX_TEST_DATABASE_URL
if (!url || !new URL(url).hostname.match(/^(127\.0\.0\.1|localhost)$/)) throw new Error('A disposable localhost BMUX_TEST_DATABASE_URL is required')
let pool = new Pool({ connectionString: url, max: 2 }), origin = 'http://127.0.0.1:18888'
await pool.query(await fs.readFile(new URL('../remote/schema.sql', import.meta.url), 'utf8'))
let digest = value => createHash('sha256').update(value).digest('hex')
let owner = randomBytes(12).toString('hex'), service = `test-${owner}`, token = randomBytes(32).toString('hex'), login = randomBytes(32).toString('hex')
let key = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' })
await pool.query('INSERT INTO bmux_services (id,owner,token_hash,public_key) VALUES ($1,$2,$3,$4)', [service, owner, digest(token), key])
await pool.query("INSERT INTO bmux_logins VALUES ($1,$2,now()+interval '1 hour')", [digest(login),owner])
let server = spawn(process.execPath, ['--import','tsx','remote/server.ts'], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url, PORT:'18888', BMUX_PUBLIC_ORIGIN: origin, BMUX_GOOGLE_CLIENT_ID:'fixture', BMUX_TURN_SECRET:'fixture-only', BMUX_TURN_URLS:'turn:127.0.0.1:3478' }, stdio: ['ignore','ignore','pipe'] })
let failures = ''
server.stderr.on('data', data => { failures += data })
let sockets = []
let wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let connect = (address, options) => new Promise((resolve,reject) => {
  let socket = new WebSocket(address, options), messages = []
  sockets.push(socket)
  socket.on('message', raw => messages.push(JSON.parse(raw)))
  socket.once('open', () => resolve({ socket, messages }))
  socket.once('error', reject)
})
let until = async predicate => { for (let n=0;n<100;n++) { if (await predicate()) return; await wait(100) }; throw new Error('Timed out') }
try {
  await until(async () => { try { return (await fetch(`${origin}/health`)).ok } catch { return false } })
  let page = await fetch(origin), html = await page.text()
  let nonce = /<meta name="csp-nonce" content="([A-Za-z0-9+/]+)">/.exec(html)?.[1]
  assert(nonce, 'The viewer receives a style nonce for Google sign-in')
  assert(page.headers.get('content-security-policy').includes(`'nonce-${nonce}'`))
  assert(!page.headers.get('content-security-policy').includes('unsafe-inline'))
  assert.equal(page.headers.get('cache-control'), 'no-store')
  assert.equal(page.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
  let nextPage = await fetch(origin).then(response => response.text())
  assert(!nextPage.includes(nonce), 'Each HTML response has a fresh nonce')
  assert.equal((await fetch(`${origin}/api/usage`)).status,401)
  let host = crypto.randomUUID(), generation = crypto.randomUUID()
  let browser = await connect(`ws://127.0.0.1:18888/connect?host=${host}&generation=${generation}`, { headers:{ Authorization:`Bearer ${token}` } })
  await until(() => browser.messages.some(m=>m.type==='ready'))
  let response = await fetch(`${origin}/api/connect`, { method:'POST', headers:{ Origin:origin, Cookie:`bmux_session=${login}`, 'Content-Type':'application/json' }, body:JSON.stringify({ publicKey:key }) })
  assert.equal(response.status,200)
  let { ticket } = await response.json()
  let viewer = await connect(`ws://127.0.0.1:18888/connect?ticket=${ticket}`, { origin })
  await until(() => viewer.messages.some(m=>m.type==='hosts' && m.hosts.some(h=>h.id===host)))
  await assert.rejects(connect(`ws://127.0.0.1:18888/connect?ticket=${ticket}`, { origin }))
  browser.socket.send(JSON.stringify({ type:'usage',sequence:2,started:3,succeeded:2,failed:1,active:0,browserMs:1000 }))
  browser.socket.send(JSON.stringify({ type:'usage',sequence:1,started:1,succeeded:0,failed:0,active:1,browserMs:10 }))
  await until(async () => (await pool.query('SELECT sequence FROM bmux_usage WHERE service=$1',[service])).rows[0]?.sequence==='2')
  let stats = await fetch(`${origin}/api/usage`, { headers:{ Cookie:`bmux_session=${login}` } }).then(r=>r.json())
  assert.equal(stats[0].started,3)
  let revoked = await fetch(`${origin}/api/revoke`, { method:'POST',headers:{ Origin:origin,Cookie:`bmux_session=${login}`,'Content-Type':'application/json' },body:JSON.stringify({id:digest(key.x)}) })
  assert.equal(revoked.status,200)
  await until(() => viewer.socket.readyState===WebSocket.CLOSED)
  assert(browser.messages.some(m=>m.type==='revoked'))
  console.log('Passed: login boundary, authenticated host discovery, single-use tickets, usage deduplication and device revocation')
} finally {
  for (let socket of sockets) socket.terminate()
  server.kill('SIGTERM')
  await new Promise(resolve=> { if(server.exitCode!==null) resolve(); else server.once('exit',resolve); setTimeout(()=>{server.kill('SIGKILL');resolve()},3000).unref() })
  await pool.query('DELETE FROM bmux_usage WHERE service=$1',[service])
  await pool.query('DELETE FROM bmux_services WHERE id=$1',[service])
  await pool.query('DELETE FROM bmux_devices WHERE owner=$1',[owner])
  await pool.query('DELETE FROM bmux_logins WHERE owner=$1',[owner])
  await pool.end()
  if (failures) process.stderr.write('Connection service reported an error; inspect the isolated test run.\n')
}
