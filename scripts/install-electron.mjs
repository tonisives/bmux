import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import os from 'node:os'
import path from 'node:path'

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
  let request = async (url, accept) => {
    let response = await fetch(url, { headers: { Accept: accept }, signal: AbortSignal.timeout(180000) })
    if (!response.ok) throw new Error(`Electron release download failed: HTTP ${response.status}`)
    return response
  }
  let release = await (await request(`https://api.github.com/repos/electron/electron/releases/tags/v${version}`, 'application/vnd.github+json')).json()
  let asset = release.assets.find(asset => asset.name === name)
  if (!asset) throw new Error(`Electron release asset missing: ${name}`)
  let directory = await mkdtemp(path.join(os.tmpdir(), 'bmux-electron-'))
  try {
    let archive = path.join(directory, name)
    let response = await request(asset.url, 'application/octet-stream')
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
    let digest = createHash('sha256')
    for await (let chunk of createReadStream(archive)) digest.update(chunk)
    if (digest.digest('hex') !== require(path.join(root, 'checksums.json'))[name]) throw new Error('Electron archive checksum mismatch')
    let electronRequire = createRequire(path.join(root, 'package.json'))
    await electronRequire('@electron-internal/extract-zip').extract(archive, { dir: path.join(root, 'dist') })
    await writeFile(path.join(root, 'path.txt'), platform === 'darwin' || platform === 'mas' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron')
  } finally { await rm(directory, { recursive: true, force: true }) }
}
