import { spawn } from 'node:child_process'

if (process.platform !== 'win32') throw new Error('Run the Windows suite on a disposable Windows desktop or the Windows workflow')
if (!process.env.BMUX_WINDOWS_APP) throw new Error('Set BMUX_WINDOWS_APP to the installed test bmux.exe')

for (let [cli, args] of [
  ['node_modules/vitest/vitest.mjs', ['run', '--config', 'vitest.windows.config.ts']],
  ['node_modules/@playwright/test/cli.js', ['test', '--config', 'playwright.windows.config.ts']],
]) {
  let child = spawn(process.execPath, [cli, ...args], { stdio: 'inherit' })
  let code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code)) })
  if (code !== 0) process.exit(code ?? 1)
}
