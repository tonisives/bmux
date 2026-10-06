import { describe, expect, it } from 'vitest'
import { runtimeDataDirectory, developmentExecutable } from '../bin/runtime-paths.mjs'

describe('portable runtime paths', () => {
  it('preserves Mac data and honors explicit and legacy overrides', () => {
    expect(runtimeDataDirectory('darwin', '/home/test', {})).toBe('/home/test/Library/Application Support/bmux')
    expect(runtimeDataDirectory('linux', '/home/test', { BMUX_DATA_DIR: '/data', BROWMUX_DATA_DIR: '/old' })).toBe('/data')
    expect(runtimeDataDirectory('linux', '/home/test', { BROWMUX_DATA_DIR: '/old' })).toBe('/old')
  })
  it('uses Linux data and executable paths', () => {
    expect(runtimeDataDirectory('linux', '/home/test', {})).toBe('/home/test/.local/share/bmux')
    expect(runtimeDataDirectory('linux', '/home/test', { XDG_DATA_HOME: '/data' })).toBe('/data/bmux')
    expect(developmentExecutable('/app', 'linux')).toBe('/app/node_modules/electron/dist/electron')
  })
  it('uses Windows application data and the Electron executable', () => {
    let home = 'C:\\Users\\Test User'
    expect(runtimeDataDirectory('win32', home, {})).toBe('C:\\Users\\Test User\\AppData\\Local\\bmux')
    expect(runtimeDataDirectory('win32', home, { LOCALAPPDATA: 'D:\\Local Data' })).toBe('D:\\Local Data\\bmux')
    expect(runtimeDataDirectory('win32', home, { BMUX_DATA_DIR: 'D:\\Isolated Data' })).toBe('D:\\Isolated Data')
    expect(developmentExecutable('C:\\bmux', 'win32')).toBe('C:\\bmux\\node_modules\\electron\\dist\\electron.exe')
  })
})
