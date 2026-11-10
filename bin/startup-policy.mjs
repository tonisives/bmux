import fs from 'node:fs'
import path from 'node:path'

let pauseFile = directory => path.join(directory, 'autostart-paused')
export let isAutoStartPaused = directory => fs.existsSync(pauseFile(directory))
export let pauseAutoStart = directory => {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.writeFileSync(pauseFile(directory), '', { mode: 0o600 })
}
export let resumeAutoStart = directory => fs.rmSync(pauseFile(directory), { force: true })
