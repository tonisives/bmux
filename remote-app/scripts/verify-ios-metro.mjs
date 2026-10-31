import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

let execute = promisify(execFile)
let delegate = await readFile(new URL('../ios/bmuxremote/AppDelegate.swift', import.meta.url), 'utf8')
let bootstrap = delegate.match(/#if DEBUG\n(    let remoteMetroURL = [\s\S]*?)    #endif/)?.[1]
assert.ok(bootstrap, 'The generated development bootstrap must exist')
let url = bootstrap.match(/let remoteMetroURL = (".*")/)?.[1]
let directory = await mkdtemp(path.join(os.tmpdir(), 'bmux-metro-bootstrap-'))
try {
  let source = `
final class UserDefaults {
  static let standard = UserDefaults()
  var values: [String: Bool] = [:]
  func bool(forKey key: String) -> Bool { values[key] ?? false }
  func set(_ value: Bool, forKey key: String) { values[key] = value }
}
final class Registry {
  var entries: [[String: Any]] = []
  var additions = 0
  func recentlyOpenedApps() -> [[String: Any]] { entries }
  func appWasOpened(_ url: String, queryParams: [String: String], manifest: String?) {
    entries.append(["url": url])
    additions += 1
  }
}
final class EXDevLauncherController {
  static let shared = EXDevLauncherController()
  let recentlyOpenedAppsRegistry = Registry()
  static func sharedInstance() -> EXDevLauncherController { shared }
}
func configure() {
${bootstrap}}
let registry = EXDevLauncherController.shared.recentlyOpenedAppsRegistry
let preferences = UserDefaults.standard
let remoteURL = ${url}
let customURL = "http://127.0.0.1:19731"
preferences.set(true, forKey: "EXDevLauncherTryToLaunchLastBundle")
registry.entries = [["url": customURL]]
configure()
precondition(!preferences.bool(forKey: "EXDevLauncherTryToLaunchLastBundle"), "Upgrade must initially expose the chooser")
precondition(registry.entries.count == 2, "Initial configuration must preserve a saved manual server")
precondition(registry.entries.contains { $0["url"] as? String == remoteURL }, "Remote server must be available")
configure()
precondition(registry.additions == 1, "Reopening must not duplicate the default server")
preferences.set(true, forKey: "EXDevLauncherTryToLaunchLastBundle")
configure()
precondition(preferences.bool(forKey: "EXDevLauncherTryToLaunchLastBundle"), "Later user launch preferences must survive")
registry.entries = [["url": customURL]]
configure()
precondition(registry.additions == 1, "An automatic connection to a saved server must not be replaced by a seeded default")
precondition(registry.entries.count == 1, "Auto-launch must preserve the saved server history")
precondition(preferences.bool(forKey: "EXDevLauncherTryToLaunchLastBundle"), "An expired entry must preserve launch preferences")
preferences.set(false, forKey: "EXDevLauncherTryToLaunchLastBundle")
configure()
precondition(registry.additions == 2, "Default must return when Expo expires its registry entry")
precondition(registry.entries.first?["url"] as? String == customURL, "An expired default must not replace the manual choice")
precondition(!preferences.bool(forKey: "EXDevLauncherTryToLaunchLastBundle"), "Restoring an expired entry must preserve chooser mode")
preferences.set(true, forKey: "EXDevLauncherTryToLaunchLastBundle")
registry.entries = []
configure()
precondition(registry.additions == 3, "The default must be available when all saved servers have expired")
precondition(preferences.bool(forKey: "EXDevLauncherTryToLaunchLastBundle"), "An empty history must preserve the user's launch preference")
print("Remote Metro migration, saved servers, deduplication, launch preference and expired-entry restoration verified")
`
  let file = path.join(directory, 'bootstrap.swift')
  await writeFile(file, source)
  let { stdout } = await execute('swift', ['-module-cache-path', path.join(directory, 'cache'), file], { timeout: 180_000 })
  console.log(stdout.trim())
} finally {
  await rm(directory, { recursive: true, force: true })
}
