import Constants from 'expo-constants'

export let origin = new URL(Constants.expoConfig?.extra?.remoteOrigin ?? 'https://remote.bmux.cc').origin
