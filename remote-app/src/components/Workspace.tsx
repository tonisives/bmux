import { useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { ReservedRegionsProvider, useReservedRegions } from 'react-native-reserved-regions'
import { workspaceLayout } from '../workspace-layout'
import { colors } from '../theme'
import { WorkspaceNavigation } from './WorkspaceNavigation'

type WorkspaceProps = { sidebar: ReactNode; detail: ReactNode; selected: boolean; onBack: () => void }

export let Workspace = (props: WorkspaceProps) =>
  <ReservedRegionsProvider style={local.fill}><WorkspaceContent {...props} /></ReservedRegionsProvider>

let WorkspaceContent = ({ sidebar, detail, selected, onBack }: WorkspaceProps) => {
  let [frame, setFrame] = useState({ width: 0, height: 0 })
  let layout = workspaceLayout(frame, useReservedRegions())
  let row = layout.direction === 'row'
  return <View style={local.fill} onLayout={({ nativeEvent: { layout } }) => setFrame({ width: layout.width, height: layout.height })}>
    {layout.split ? <View style={[local.fill, { flexDirection: layout.direction, gap: layout.gap }, row
      ? { marginLeft: layout.insetStart, marginRight: layout.insetEnd }
      : { marginTop: layout.insetStart, marginBottom: layout.insetEnd }]}>
      <View style={[local.pane, row
        ? { width: layout.sidebarSize, borderRightWidth: 1, borderRightColor: colors.border }
        : { height: layout.sidebarSize, borderBottomWidth: 1, borderBottomColor: colors.border }]}>{sidebar}</View>
      <View style={local.fill}>{detail}</View>
    </View> : <WorkspaceNavigation sidebar={sidebar} detail={detail} selected={selected} onBack={onBack} />}
  </View>
}
let local = StyleSheet.create({ pane: { flexShrink: 0, minWidth: 0, minHeight: 0 }, fill: { flex: 1, minWidth: 0, minHeight: 0 } })
