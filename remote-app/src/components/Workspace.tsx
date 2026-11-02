import { useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { ReservedRegionsProvider, useReservedRegions } from 'react-native-reserved-regions'
import { workspaceLayout } from '../workspace-layout'
import { WorkspaceNavigation } from './WorkspaceNavigation'

type WorkspaceProps = { sidebar: ReactNode; detail: ReactNode; selected: boolean; onBack: () => void }

export let Workspace = (props: WorkspaceProps) =>
  <ReservedRegionsProvider style={local.fill}><WorkspaceContent {...props} /></ReservedRegionsProvider>

let WorkspaceContent = (props: WorkspaceProps) => {
  let [frame, setFrame] = useState({ width: 0, height: 0 })
  let layout = workspaceLayout(frame, useReservedRegions())
  return <View style={local.fill} onLayout={({ nativeEvent: { layout } }) => setFrame({ width: layout.width, height: layout.height })}>
    <WorkspaceNavigation {...props} layout={layout} />
  </View>
}
let local = StyleSheet.create({ fill: { flex: 1, minWidth: 0, minHeight: 0 } })
