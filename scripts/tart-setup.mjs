import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

let version = '2.37.0'
let checksum = 'd531752c4dad5d4214ac7ff540cefc2647df1fca2338d413d3c01754f54b356b'
let installDirectory = '/Volumes/sam/apps/tart'
let tartHome = process.env.TART_HOME ?? '/Volumes/sam/tart'
let binary = process.env.BMUX_TART_BIN ?? path.join(installDirectory, 'tart.app/Contents/MacOS/tart')
let vm = process.env.BMUX_TART_VM ?? 'bmux-tests'
let image = process.env.BMUX_TART_IMAGE ?? 'ghcr.io/cirruslabs/macos-tahoe-base:latest'
let env = { ...process.env, TART_HOME: tartHome }
let run = (command, args, capture = false) => {
  let result = spawnSync(command, args, { env, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status) throw new Error(`${path.basename(command)} exited ${result.status}${capture ? `: ${result.stderr.trim()}` : ''}`)
  return result.stdout?.trim()
}

try {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This setup requires an Apple Silicon Mac.')
  await fs.access('/Volumes/sam')
  await fs.mkdir(tartHome, { recursive: true })
  try { await fs.access(binary, fs.constants.X_OK) } catch {
    let downloads = path.join(installDirectory, 'downloads')
    await fs.mkdir(downloads, { recursive: true })
    let archive = path.join(downloads, `tart-${version}.tar.gz`)
    run('curl', ['-fL', '--retry', '3', '-o', archive, `https://github.com/openai/tart/releases/download/${version}/tart.tar.gz`])
    if (createHash('sha256').update(await fs.readFile(archive)).digest('hex') !== checksum) throw new Error('Tart release checksum mismatch.')
    run('tar', ['-xzf', archive, '-C', installDirectory])
  }
  console.log(`Tart ${run(binary, ['--version'], true)} at ${binary}`)

  let config = path.join(os.homedir(), '.config/aerospace/aerospace.toml')
  let previous = await fs.readFile(config, 'utf8')
  let rule = "[[on-window-detected]]\nif.app-id = 'com.github.cirruslabs.tart'\nrun = 'move-node-to-workspace bot'\n\n"
  if (!previous.includes('com.github.cirruslabs.tart')) {
    let updated = previous.replace('[[on-window-detected]]', rule + '[[on-window-detected]]')
    if (updated === previous) throw new Error('Expected AeroSpace on-window-detected tables; configure the Tart rule manually before continuing.')
    let backup = `${config}.before-bmux-tart-${Date.now()}`
    await fs.copyFile(config, backup)
    await fs.writeFile(config, updated)
    try { run('aerospace', ['reload-config']) } catch (error) { await fs.writeFile(config, previous); throw error }
    console.log(`Tart viewer assigned to bot; previous AeroSpace config saved at ${backup}`)
  }

  let machines = JSON.parse(run(binary, ['list', '--source', 'local', '--format', 'json'], true))
  let current = machines.find(item => item.Name === vm)
  if (!current) run(binary, ['clone', image, vm])
  if (!current?.Running) {
    let settings = JSON.parse(run(binary, ['get', vm, '--format', 'json'], true))
    run(binary, ['set', vm, '--cpu', '4', '--memory', '8192', '--display', '1440x1000', '--no-display-refit', ...(settings.Disk < 80 ? ['--disk-size', '80'] : [])])
  }
  console.log(`VM ${vm} is ready in ${tartHome}. Run pnpm vm:start, then pnpm test:electron.`)
} catch (error) { console.error(error.message); process.exitCode = 1 }
