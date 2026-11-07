import path from 'node:path'

export let runtimeDataDirectory = (platform, home, env) => env.BMUX_DATA_DIR ?? env.BROWMUX_DATA_DIR ?? (platform === 'win32'
  ? path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'bmux')
  : platform === 'darwin' ? path.posix.join(home, 'Library', 'Application Support', 'bmux')
  : path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share'), 'bmux'))

export let developmentExecutable = (root, platform) => (platform === 'win32' ? path.win32 : path.posix).join(root, 'node_modules', 'electron', 'dist', ...(platform === 'darwin' ? ['Electron.app', 'Contents', 'MacOS', 'Electron'] : [platform === 'win32' ? 'electron.exe' : 'electron']))

export let macAppCandidates = (root, home, env) => {
  let installed = path.join(home, 'workspace', '_tools', 'bmux.app')
  let output = path.resolve(root, env.BMUX_OUTPUT_DIR || 'build', 'bmux.app')
  return env.BMUX_OUTPUT_DIR ? [output, installed] : [installed, output]
}
