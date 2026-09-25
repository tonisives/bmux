import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
let release = path.resolve('release')
let candidates = (await fs.readdir(release)).filter(name => /^linux.*-unpacked$/.test(name))
if (candidates.length !== 1) throw new Error('Expected one Linux package; use a clean release directory')
await fs.cp(path.join(release, candidates[0]), path.join(release, 'runtime'), { recursive: true })
execFileSync('tar', ['-czf', path.join(release, `bmux-linux-${process.arch}.tar.gz`), '-C', path.join(release, 'runtime'), '.'], { stdio: 'inherit' })
