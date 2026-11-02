import type { ReactNode } from 'react'
import { View } from 'react-native'

export type WorkspaceNavigationProps = { sidebar: ReactNode; detail: ReactNode; selected: boolean; onBack: () => void }

export let WorkspaceNavigation = ({ sidebar, detail, selected }: WorkspaceNavigationProps) => <View style={{ flex: 1, minHeight: 0 }}>
  <View style={{ flex: 1, display: selected ? 'none' : 'flex' }}>{sidebar}</View>
  {selected && <View style={{ flex: 1 }}>{detail}</View>}
</View>
