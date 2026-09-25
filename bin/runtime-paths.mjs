import path from 'node:path'

export let runtimeDataDirectory = (platform, home, env) => env.BMUX_DATA_DIR ?? env.BROWMUX_DATA_DIR ?? (platform === 'darwin'
  ? path.join(home, 'Library', 'Application Support', 'bmux')
  : path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'bmux'))

export let developmentExecutable = (root, platform) => path.join(root, 'node_modules', 'electron', 'dist', ...(platform === 'darwin' ? ['Electron.app', 'Contents', 'MacOS', 'Electron'] : ['electron']))
