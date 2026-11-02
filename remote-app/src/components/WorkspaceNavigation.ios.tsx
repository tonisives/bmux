import { ScreenStack, ScreenStackItem } from 'react-native-screens'
import { colors } from '../theme'
import { WorkspacePanes, type WorkspaceNavigationProps } from './WorkspacePanes'

export let WorkspaceNavigation = (props: WorkspaceNavigationProps) => {
  let { sidebar, detail, selected, onBack, layout } = props
  if (layout.split) return <WorkspacePanes {...props} />
  return <ScreenStack style={{ flex: 1 }}>
  <ScreenStackItem screenId="sessions" accessibilityElementsHidden={selected} activityState={2} headerConfig={{ hidden: true }} contentStyle={{ flex: 1, backgroundColor: colors.bg }}>
    {sidebar}
  </ScreenStackItem>
  {selected && <ScreenStackItem screenId="browser" activityState={2} stackPresentation="push" stackAnimation="default" gestureEnabled fullScreenSwipeEnabled={false} hideKeyboardOnSwipe onDismissed={onBack} headerConfig={{ hidden: true }} contentStyle={{ flex: 1, backgroundColor: colors.bg }}>
    {detail}
  </ScreenStackItem>}
</ScreenStack>
}
