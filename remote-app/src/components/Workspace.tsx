import { useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { ReservedRegionsProvider, useReservedRegions } from 'react-native-reserved-regions'
import { workspaceLayout } from '../workspace-layout'
import { colors } from '../theme'

export let Workspace = (props: { sidebar: ReactNode; detail: ReactNode; selected: boolean }) =>
  <ReservedRegionsProvider style={local.fill}><WorkspaceContent {...props} /></ReservedRegionsProvider>

let WorkspaceContent = ({ sidebar, detail, selected }: { sidebar: ReactNode; detail: ReactNode; selected: boolean }) => {
  let [frame, setFrame] = useState({ width: 0, height: 0 })
  let layout = workspaceLayout(frame, useReservedRegions())
  let row = layout.direction === 'row'
  return <View style={local.fill} onLayout={({ nativeEvent: { layout } }) => setFrame({ width: layout.width, height: layout.height })}>
    <View style={[local.fill, { flexDirection: layout.direction, gap: layout.gap }, row
      ? { marginLeft: layout.insetStart, marginRight: layout.insetEnd }
      : { marginTop: layout.insetStart, marginBottom: layout.insetEnd }]}>
      <View key="sidebar" accessibilityElementsHidden={!layout.split && selected} importantForAccessibility={!layout.split && selected ? 'no-hide-descendants' : 'auto'} style={[local.pane, !layout.split && local.fill, layout.split && (row
        ? { flexShrink: 0, width: layout.sidebarSize, borderRightWidth: 1, borderRightColor: colors.border }
        : { flexShrink: 0, height: layout.sidebarSize, borderBottomWidth: 1, borderBottomColor: colors.border }),
        !layout.split && selected && local.hidden]}>{sidebar}</View>
      <View key="detail" accessibilityElementsHidden={!layout.split && !selected} importantForAccessibility={!layout.split && !selected ? 'no-hide-descendants' : 'auto'} style={[local.fill, !layout.split && !selected && local.hidden]}>{detail}</View>
    </View>
  </View>
}
let local = StyleSheet.create({ pane: { minWidth: 0, minHeight: 0 }, fill: { flex: 1, minWidth: 0, minHeight: 0 }, hidden: { display: 'none' } })
