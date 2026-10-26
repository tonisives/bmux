import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

let execute = promisify(execFile)
let project = new URL('../ios/bmuxremote/', import.meta.url)
let { stdout } = await execute('plutil', ['-convert', 'json', '-o', '-', fileURLToPath(new URL('Info.plist', project))])
let info = JSON.parse(stdout)
let manifest = info.UIApplicationSceneManifest
assert.equal(manifest?.UIApplicationSupportsMultipleScenes, false, 'The iOS app must adopt the single-window scene lifecycle')
let scenes = manifest.UISceneConfigurations?.UIWindowSceneSessionRoleApplication
assert.ok(scenes?.some(scene => scene.UISceneDelegateClassName === 'EXExpoAppSceneDelegate'), 'Expo must own the application scene')

let delegate = await readFile(new URL('AppDelegate.swift', project), 'utf8')
assert.match(delegate, /class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider\s*\{/, 'The scene needs the React Native factory from AppDelegate')
assert.match(delegate, /\breactNativeFactory\s*=\s*factory\b/)
assert.doesNotMatch(delegate, /UIWindow\s*\(/, 'The scene must create the window')
assert.doesNotMatch(delegate, /factory\.startReactNative\s*\(/, 'The scene must start React Native')

let schemes = new Set(info.CFBundleURLTypes.flatMap(type => type.CFBundleURLSchemes))
assert.ok(schemes.has('bmux-remote'), 'Attention and sign-in links need the app scheme')
assert.ok(schemes.has('exp+bmux-remote'), 'The development client needs its Metro launch scheme')
assert.equal(info.DEV_CLIENT_TRY_TO_LAUNCH_LAST_BUNDLE, false, 'Development builds must show the server chooser')
assert.equal(info.DEV_CLIENT_DEFAULT_LAUNCHER_URL, undefined, 'A default launch URL would bypass the server chooser')
assert.match(delegate, /#if DEBUG\s+let remoteMetroURL = /, 'The remote server entry belongs only to development builds')
assert.match(delegate, /registry\.appWasOpened\(remoteMetroURL, queryParams: \[:\], manifest: nil\)/)
console.log('iOS scene lifecycle, window startup, launch schemes and development server chooser verified')
