import fs from 'node:fs'

for (let name of ['APPLE_SIGNING_IDENTITY', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
  if (!process.env[name]?.trim()) throw new Error(`Release packaging requires ${name}`)
}
let arch = process.env.BMUX_NATIVE_ARCH
if (!['arm64', 'x64'].includes(arch)) throw new Error('BMUX_NATIVE_ARCH must be arm64 or x64')
let { build } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
let config = {
  ...build,
  forceCodeSigning: true,
  mac: { ...build.mac, identity: process.env.APPLE_SIGNING_IDENTITY.replace(/^Developer ID Application:\s*/, ''), type: 'distribution', notarize: true, target: ['dmg', 'zip'] },
  dmg: { sign: true },
  publish: { provider: 'github', owner: 'tonisives', repo: 'bmux', channel: `latest-${arch}` },
}
export { config as default }
