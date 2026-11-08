import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import os from 'node:os'
import path from 'node:path'

let request = async (url, accept) => {
  let response = await fetch(url, { headers: { Accept: accept }, signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error(`GitHub release download failed: HTTP ${response.status}`)
  return response
}
let download = async (repository, tag, name, archive, checksum) => {
  let release = await (await request(`https://api.github.com/repos/${repository}/releases/tags/${tag}`, 'application/vnd.github+json')).json()
  let asset = release.assets.find(asset => asset.name === name)
  if (!asset) throw new Error(`Release asset missing: ${name}`)
  let response = await request(asset.url, 'application/octet-stream')
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
  let digest = createHash('sha256')
  for await (let chunk of createReadStream(archive)) digest.update(chunk)
  if (digest.digest('hex') !== checksum) { await rm(archive, { force: true }); throw new Error(`Archive checksum mismatch: ${name}`) }
}

let require = createRequire(import.meta.url)
let root = path.dirname(require.resolve('electron/package.json'))
let installed = await new Promise((resolve, reject) => {
  let child = spawn(process.execPath, [path.join(root, 'install.js')], { stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', code => resolve(code === 0))
})
if (!installed) {
  console.log('Downloading Electron through the official GitHub release API')
  let { version } = require(path.join(root, 'package.json'))
  let platform = process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || process.platform
  let arch = process.env.ELECTRON_INSTALL_ARCH || process.env.npm_config_arch || process.arch
  let name = `electron-v${version}-${platform}-${arch}.zip`
  let directory = await mkdtemp(path.join(os.tmpdir(), 'bmux-electron-'))
  try {
    let archive = path.join(directory, name)
    await download('electron/electron', `v${version}`, name, archive, require(path.join(root, 'checksums.json'))[name])
    let electronRequire = createRequire(path.join(root, 'package.json'))
    await electronRequire('@electron-internal/extract-zip').extract(archive, { dir: path.join(root, 'dist') })
    await writeFile(path.join(root, 'path.txt'), platform === 'darwin' || platform === 'mas' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron')
  } finally { await rm(directory, { recursive: true, force: true }) }
}

if (process.platform === 'win32' && process.argv.includes('--windows-installer')) {
  let cache = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache')
  // These archives match electron-builder's legacy NSIS toolset and checksums.
  let tools = [
    ['nsis-3.0.4.1', '9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa'],
    ['nsis-resources-3.4.1', '593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103'],
  ]
  for (let [tag, checksum] of tools) {
    let directory = path.join(cache, tag), name = `${tag}.7z`, archive = path.join(directory, name)
    try { await access(archive); continue } catch {}
    await mkdir(directory, { recursive: true })
    await download('electron-userland/electron-builder-binaries', tag, name, archive, checksum)
  }
}
