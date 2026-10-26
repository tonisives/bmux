import { Platform, useWindowDimensions } from 'react-native'

export let useSplitView = () => {
  let { width, height } = useWindowDimensions()
  return Platform.OS === 'web' ? width >= 768 : Math.min(width, height) >= 700
}

export let useCompactHeight = () => useWindowDimensions().height < 500
