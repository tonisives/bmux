import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import type { workspaceLayout } from '../workspace-layout'
import { colors } from '../theme'

export type WorkspaceNavigationProps = { sidebar: ReactNode; detail: ReactNode; selected: boolean; onBack: () => void; layout: ReturnType<typeof workspaceLayout> }

export let WorkspacePanes = ({ sidebar, detail, selected, layout }: WorkspaceNavigationProps) => {
  let row = layout.direction === 'row'
  return <View style={[local.fill, { flexDirection: layout.direction, gap: layout.gap }, row
    ? { marginLeft: layout.insetStart, marginRight: layout.insetEnd }
    : { marginTop: layout.insetStart, marginBottom: layout.insetEnd }]}>
    <View key="sidebar" accessibilityElementsHidden={!layout.split && selected} importantForAccessibility={!layout.split && selected ? 'no-hide-descendants' : 'auto'} style={[local.pane, !layout.split && local.fill, layout.split && (row
      ? { width: layout.sidebarSize, borderRightWidth: 1, borderRightColor: colors.border }
      : { height: layout.sidebarSize, borderBottomWidth: 1, borderBottomColor: colors.border }), !layout.split && selected && local.hidden]}>{sidebar}</View>
    <View key="detail" accessibilityElementsHidden={!layout.split && !selected} importantForAccessibility={!layout.split && !selected ? 'no-hide-descendants' : 'auto'} style={[local.fill, !layout.split && !selected && local.hidden]}>{detail}</View>
  </View>
}
let local = StyleSheet.create({ pane: { flexShrink: 0, minWidth: 0, minHeight: 0 }, fill: { flex: 1, minWidth: 0, minHeight: 0 }, hidden: { display: 'none' } })
