import fs from 'node:fs/promises'
import { createReadStream, writeSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

let root = process.cwd()
let tartHome = process.env.TART_HOME ?? '/Volumes/sam/tart'
let binary = process.env.BMUX_TART_BIN ?? '/Volumes/sam/apps/tart/tart.app/Contents/MacOS/tart'
let vm = process.env.BMUX_TART_VM ?? 'bmux-tests'
let env = { ...process.env, TART_HOME: tartHome, COPYFILE_DISABLE: '1' }
let stateDirectory = path.join(tartHome, 'bmux-runner')
let [mode = 'status', ...args] = process.argv.slice(2)
let testModes = ['electron', 'ui', 'debug', 'package-smoke']
let guestPath = '/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
let quote = value => `'${String(value).replaceAll("'", "'\\''")}'`

let run = (command, argv, options = {}) => new Promise((resolve, reject) => {
  let child = spawn(command, argv, { cwd: root, env, timeout: options.timeout, stdio: [options.input ? 'pipe' : 'ignore', options.outputFd ?? (options.capture || options.logFd !== undefined ? 'pipe' : 'inherit'), options.capture || options.logFd !== undefined ? 'pipe' : 'inherit'] })
  let stdout = [], stderr = []
  child.stdout?.on('data', chunk => {
    if (options.logFd !== undefined) { process.stdout.write(chunk); writeSync(options.logFd, chunk) }
    else stdout.push(chunk)
  })
  child.stderr?.on('data', chunk => {
    if (options.logFd !== undefined) { process.stderr.write(chunk); writeSync(options.logFd, chunk) }
    else stderr.push(chunk)
  })
  let interrupt = signal => child.kill(signal)
  let onInt = () => interrupt('SIGINT'), onTerm = () => interrupt('SIGTERM')
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm)
  child.once('error', reject)
  child.once('close', (code, signal) => {
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm)
    let result = { code: code ?? (signal ? 130 : 1), stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }
    if (result.code && !options.allowFailure) reject(new Error(`${path.basename(command)} exited ${result.code}${result.stderr ? `: ${result.stderr.trim()}` : ''}`))
    else resolve(result)
  })
  if (options.input) {
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error) })
    if (typeof options.input === 'string' || Buffer.isBuffer(options.input)) child.stdin.end(options.input)
    else options.input.pipe(child.stdin)
  }
})
let tart = (argv, options) => run(binary, argv, options)
let guest = (argv, options) => tart(['exec', ...(options?.input ? ['-i'] : []), vm, ...argv], options)
let shell = (script, options) => guest(['/bin/bash', '-c', script], options)
let status = async () => JSON.parse((await tart(['list', '--source', 'local', '--format', 'json'], { capture: true })).stdout).find(item => item.Name === vm)

let lock = async task => {
  await fs.mkdir(stateDirectory, { recursive: true })
  let lockPath = path.join(stateDirectory, `${vm}.lock`), waiting = false
  for (;;) {
    try {
      let file = await fs.open(lockPath, 'wx', 0o600)
      await file.writeFile(String(process.pid)); await file.close()
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let owner = Number(await fs.readFile(lockPath, 'utf8').catch(() => ''))
      if (owner > 0) {
        try { process.kill(owner, 0) } catch (error) {
          if (error.code === 'ESRCH') { await fs.unlink(lockPath).catch(() => {}); continue }
          throw error
        }
      }
      if (!owner) {
        let age = Date.now() - (await fs.stat(lockPath).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
        if (age > 30000) { await fs.unlink(lockPath).catch(() => {}); continue }
      }
      if (!waiting) { console.log(`Waiting for the other ${vm} operation to finish.`); waiting = true }
      await delay(2000)
    }
  }
  try { return await task() } finally { await fs.unlink(lockPath) }
}

let start = async () => {
  let current = await status()
  if (!current) throw new Error(`VM ${vm} is missing. Follow docs/tart-tests.md to install it.`)
  if (!current.Running) {
    await fs.mkdir(stateDirectory, { recursive: true })
    let log = await fs.open(path.join(stateDirectory, `${vm}.log`), 'a', 0o600)
    let child = spawn(binary, ['run', vm, '--no-audio', '--no-clipboard', ...(process.env.BMUX_TART_HEADLESS === '1' ? ['--no-graphics'] : [])], { cwd: tartHome, detached: true, env, stdio: ['ignore', log.fd, log.fd] })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    child.unref(); await log.close()
    console.log(`Starting ${vm}; its viewer belongs on AeroSpace workspace bot.`)
  }
  let deadline = Date.now() + 180000
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    let probe = await guest(['/usr/bin/id', '-un'], { capture: true, allowFailure: true, timeout: 5000 })
    if (!probe.code && probe.stdout.trim() === 'admin') return
    if (attempt > 3 && !(await status())?.Running) throw new Error(`VM stopped during startup. Check ${path.join(stateDirectory, `${vm}.log`)}.`)
    await delay(2000)
  }
  throw new Error('The VM guest agent did not become ready within three minutes.')
}

let nativeTest = async () => {
  if (mode === 'package-smoke' || process.env.BMUX_TEST_PACKAGED === '1' || process.env.BMUX_TEST_INSTALLED === '1' || args.includes('--installed')) await run('pnpm', ['package'])
  else await run('pnpm', ['build'])
  if (mode === 'electron') return run('pnpm', ['exec', 'playwright', 'test', '--workers=1', ...args], { allowFailure: true })
  if (mode === 'package-smoke') return run(process.execPath, ['scripts/smoke-packaged.mjs', ...args], { allowFailure: true })
  return run(process.execPath, ['scripts/check-ui.mjs', ...(mode === 'debug' ? ['--keep-open'] : []), ...args], { allowFailure: true })
}

let vmTest = async () => {
  await start()
  let id = createHash('sha256').update(await fs.realpath(root)).digest('hex').slice(0, 16)
  let checkout = `/Users/admin/bmux-worktrees/${id}`
  let temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-tart-'))
  let resultDirectory = path.join(root, 'artifacts', 'tart', new Date().toISOString().replaceAll(':', '-'))
  await fs.mkdir(resultDirectory, { recursive: true })
  try {
    let listed = (await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { capture: true })).stdout.split('\0').filter(Boolean)
    let files = []
    for (let file of new Set(listed)) {
      if (file.split('/').some(part => ['.git', '.worktrees', '.test-data', 'node_modules', 'artifacts', 'test-results'].includes(part) || part === '.env' || part.startsWith('.env.'))) continue
      try { await fs.lstat(path.join(root, file)); files.push(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    let archive = path.join(temporary, 'source.tar')
    await run('/usr/bin/tar', ['-cf', archive, '--null', '-T', '-'], { input: files.join('\0') + '\0' })
    // The guest receives a snapshot, including edits in this worktree, with its own dependencies.
    await shell(`set -euo pipefail
mkdir -p ${quote(checkout)}
staging=$(mktemp -d /tmp/bmux-source.XXXXXX)
trap 'rm -rf "$staging"' EXIT
tar -xf - -C "$staging"
rsync -a --delete --exclude=node_modules --exclude=out --exclude=release --exclude=artifacts --exclude=test-results "$staging/" ${quote(checkout + '/')}
`, { input: createReadStream(archive) })
    let forwarded = ['BMUX_TEST_PACKAGED', 'BMUX_TEST_INSTALLED', 'BMUX_TEST_URL', 'BMUX_TEST_SELECTOR', 'BMUX_TEST_SECOND_URL', 'BROWMUX_TEST_URL', 'BROWMUX_TEST_SELECTOR', 'BROWMUX_TEST_SECOND_URL'].filter(key => process.env[key]).map(key => `${key}=${quote(process.env[key])}`).join(' ')
    console.log(`Running ${mode} in ${vm} (${checkout}).`)
    let log = await fs.open(path.join(resultDirectory, 'test.log'), 'w', 0o600)
    let result
    try { result = await shell(`set -euo pipefail
export PATH=${quote(guestPath)}
export BMUX_TEST_NATIVE=1
export CI=1
cd ${quote(checkout)}
mkdir -p artifacts test-results
rm -rf artifacts/* test-results/*
pnpm install --frozen-lockfile --child-concurrency=4
${forwarded} node scripts/tart.mjs ${[mode, ...args].map(quote).join(' ')}
`, { allowFailure: true, logFd: log.fd }) } finally { await log.close() }
    await shell(`mkdir -p ${quote(checkout + '/artifacts')} ${quote(checkout + '/test-results')}`)
    let outputArchive = path.join(temporary, 'results.tar')
    let output = await fs.open(outputArchive, 'w')
    try {
      await guest(['/usr/bin/tar', '-cf', '-', '-C', checkout, 'artifacts', 'test-results'], { outputFd: output.fd })
    } finally { await output.close() }
    if ((await fs.stat(outputArchive)).size) await run('/usr/bin/tar', ['-xf', outputArchive, '-C', resultDirectory])
    console.log(`Guest test artifacts: ${resultDirectory}`)
    return result
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
}

try {
  if (testModes.includes(mode)) {
    let native = process.env.BMUX_TEST_NATIVE === '1' || process.env.GITHUB_ACTIONS === 'true'
    process.exitCode = (await (native ? nativeTest() : lock(vmTest))).code
  } else if (mode === 'start') await lock(start)
  else if (mode === 'stop') await lock(() => tart(['stop', vm]))
  else if (mode === 'status') console.log(JSON.stringify(await status(), null, 2))
  else if (mode === 'exec') { if (!args.length) throw new Error('Usage: pnpm vm:exec COMMAND [ARGUMENTS]'); await guest(args) }
  else throw new Error(`Unknown Tart action: ${mode}`)
} catch (error) { console.error(error.message); process.exitCode = 1 }
