import type { ExpoConfig } from 'expo/config'

let config: ExpoConfig = {
  name: 'bmux remote',
  slug: 'bmux-remote',
  owner: 'tonisives',
  version: '1.0.0',
  icon: '../design/app-icon.png',
  scheme: 'bmux-remote',
  userInterfaceStyle: 'dark',
  orientation: 'default',
  ios: {
    bundleIdentifier: 'cc.bmux.remote',
    supportsTablet: true,
    associatedDomains: ['applinks:remote.bmux.cc'],
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: 'cc.bmux.remote',
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
    blockedPermissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.BLUETOOTH', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'],
    intentFilters: [{ action: 'VIEW', autoVerify: true, data: [{ scheme: 'https', host: 'remote.bmux.cc', pathPrefix: '/attention/' }], category: ['BROWSABLE', 'DEFAULT'] }],
  },
  web: { bundler: 'metro', output: 'single' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-web-browser',
    ['expo-dev-client', { ios: { launchMode: 'launcher' } }],
    ['./plugins/with-ios-remote-metro.cjs', { url: process.env.BMUX_DEV_METRO_URL ?? 'https://metro-mobile.bmux.cc' }],
    ['expo-build-properties', { ios: { enableSceneSupport: true } }],
    ['expo-notifications', { color: '#7986cb', defaultChannel: 'attention' }],
    ['@config-plugins/react-native-webrtc', { cameraPermission: false, microphonePermission: false }],
  ],
  extra: {
    remoteOrigin: process.env.EXPO_PUBLIC_REMOTE_ORIGIN ?? 'https://remote.bmux.cc',
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? 'bb9e879b-323b-4054-a2b1-e3d9f86de092' },
  },
}

export default config
