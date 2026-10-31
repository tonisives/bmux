import { useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { hasWorkspaceSpace } from './workspace-layout'

export let useSplitView = () => {
  let { width } = useWindowDimensions()
  let { left, right } = useSafeAreaInsets()
  return hasWorkspaceSpace(width - left - right)
}

export let useCompactHeight = () => useWindowDimensions().height < 500
