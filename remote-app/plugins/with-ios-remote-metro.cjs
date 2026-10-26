let { createRunOncePlugin, withAppDelegate } = require('expo/config-plugins')

let withIosRemoteMetro = (config, { url }) => withAppDelegate(config, config => {
  let source = config.modResults.contents
  let anchor = '    let delegate = ReactNativeDelegate()'
  let marker = '    let remoteMetroURL = '
  if (config.modResults.language !== 'swift' || !source.includes(anchor)) {
    throw new Error('The remote Metro launcher requires the Expo Swift AppDelegate')
  }
  if (!source.includes(marker)) {
    let bootstrap = `    #if DEBUG
    let remoteMetroURL = ${JSON.stringify(url)}
    let preferences = UserDefaults.standard
    if !preferences.bool(forKey: "bmux.devlauncher.remoteMetroConfigured") {
      preferences.set(false, forKey: "EXDevLauncherTryToLaunchLastBundle")
      preferences.set(true, forKey: "bmux.devlauncher.remoteMetroConfigured")
    }
    let registry = EXDevLauncherController.sharedInstance().recentlyOpenedAppsRegistry
    let recentApps = registry.recentlyOpenedApps()
    let canSeedDefault = recentApps.isEmpty || !preferences.bool(forKey: "EXDevLauncherTryToLaunchLastBundle")
    if canSeedDefault && !recentApps.contains(where: { ($0["url"] as? String) == remoteMetroURL }) {
      registry.appWasOpened(remoteMetroURL, queryParams: [:], manifest: nil)
    }
    #endif

`
    source = '#if DEBUG\ninternal import EXDevLauncher\n#endif\n' + source.replace(anchor, bootstrap + anchor)
  }
  config.modResults.contents = source
  return config
})

module.exports = createRunOncePlugin(withIosRemoteMetro, 'bmux-ios-remote-metro', '1.0.0')
