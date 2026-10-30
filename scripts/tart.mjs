import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

let root = process.cwd()
let env = { ...process.env }
let [mode = 'status', ...args] = process.argv.slice(2)
let testModes = ['electron', 'ui', 'debug', 'package-smoke', 'bitwarden-desktop']
let controller = process.env.BUILDCTL ?? path.join(os.homedir(), '.agents/scripts/buildctl')

let run = (command, argv, options = {}) => new Promise((resolve, reject) => {
  let child = spawn(command, argv, { cwd: root, env, timeout: options.timeout, stdio: [options.input ? 'pipe' : 'ignore', options.capture ? 'pipe' : 'inherit', options.capture ? 'pipe' : 'inherit'] })
  let stdout = [], stderr = []
  child.stdout?.on('data', chunk => {
    stdout.push(chunk)
  })
  child.stderr?.on('data', chunk => {
    stderr.push(chunk)
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
let nativeTest = async () => {
  // Electron can lazily download its binary with a synchronous require().
  // Prepare it asynchronously before Playwright starts individual test deadlines.
  await run(process.execPath, ['node_modules/electron/install.js'], { timeout: 300000 })
  if (mode === 'package-smoke' || process.env.BMUX_TEST_PACKAGED === '1' || process.env.BMUX_TEST_INSTALLED === '1' || args.includes('--installed')) await run('pnpm', ['package'])
  else await run('pnpm', ['build'])
  if (mode === 'electron') return run('pnpm', ['exec', 'playwright', 'test', '--workers=1', ...args], { allowFailure: true })
  if (mode === 'bitwarden-desktop') return run(process.execPath, ['scripts/verify-bitwarden-desktop.mjs', ...args], { allowFailure: true })
  if (mode === 'package-smoke') return run(process.execPath, ['scripts/smoke-packaged.mjs', ...args], { allowFailure: true })
  return run(process.execPath, ['scripts/check-ui.mjs', ...(mode === 'debug' ? ['--keep-open'] : []), ...args], { allowFailure: true })
}

try {
  if (testModes.includes(mode)) {
    if (process.env.GITHUB_ACTIONS !== 'true') {
      throw new Error('BMUX tests run in GitHub Actions. Push the merged commit and wait for Check; see docs/tart-tests.md.')
    }
    process.exitCode = (await nativeTest()).code
  } else if (mode === 'status') process.exitCode = (await run(controller, ['status'])).code
  else if (['start', 'stop', 'exec'].includes(mode)) {
    throw new Error('The shared build controller owns the local VM. BMUX tests run in GitHub Actions; use pnpm vm:status.')
  } else throw new Error(`Unknown Tart action: ${mode}`)
} catch (error) { console.error(error.message); process.exitCode = 1 }
