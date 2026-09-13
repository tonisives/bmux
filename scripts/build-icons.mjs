import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let root = fileURLToPath(new URL('..', import.meta.url))
let source = join(root, 'design/app-icon.png')
let temporary = await mkdtemp(join(tmpdir(), 'bmux-icons-'))
let iconset = join(temporary, 'bmux.iconset')
let resize = (size, destination) => execFileSync('sips', ['-z', String(size), String(size), source, '--out', destination], { stdio: 'ignore' })

try {
  await mkdir(iconset)
  await mkdir(join(root, 'build'), { recursive: true })
  for (let size of [16, 32, 128, 256, 512]) {
    resize(size, join(iconset, `icon_${size}x${size}.png`))
    resize(size * 2, join(iconset, `icon_${size}x${size}@2x.png`))
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build/icon.icns')])
  console.log('Generated the Little lantern app icon.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
