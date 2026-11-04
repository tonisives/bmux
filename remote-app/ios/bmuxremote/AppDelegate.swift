#if DEBUG
internal import EXDevLauncher
#endif
internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    #if DEBUG
    let remoteMetroURL = "https://metro-mobile.bmux.cc"
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

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // The window is created and React Native is started by `SceneDelegate` under the
    // scene-based life cycle (required by the iOS 27 SDK).
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
