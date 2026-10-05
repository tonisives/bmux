import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let root = fileURLToPath(new URL('..', import.meta.url))
let source = join(root, 'design/app-icon.png')
let temporary = await mkdtemp(join(tmpdir(), 'bmux-icons-'))
let iconset = join(temporary, 'bmux.iconset')
let resize = (size, destination) => execFileSync('sips', ['-s', 'format', 'png', '-z', String(size), String(size), source, '--out', destination], { stdio: 'ignore' })

try {
  await mkdir(iconset)
  await mkdir(join(root, 'build'), { recursive: true })
  for (let size of [16, 32, 128, 256, 512]) {
    resize(size, join(iconset, `icon_${size}x${size}.png`))
    resize(size * 2, join(iconset, `icon_${size}x${size}@2x.png`))
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build/icon.icns')])
  // Windows supports a PNG image inside an ICO container. Ship the icon so
  // packaging never needs to convert the macOS ICNS with a native helper.
  let png = await readFile(join(iconset, 'icon_128x128@2x.png'))
  let header = Buffer.alloc(22)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4)
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(header.length, 18)
  await writeFile(join(root, 'build/icon.ico'), Buffer.concat([header, png]))
  console.log('Generated the Little lantern app icon.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
