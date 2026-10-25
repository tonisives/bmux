import { Platform, useWindowDimensions } from 'react-native'

export let useSplitView = () => {
  let { width, height } = useWindowDimensions()
  return Platform.OS === 'ios' ? width >= 700 && width > height : width >= 768
}

export let useCompactHeight = () => useWindowDimensions().height < 500
