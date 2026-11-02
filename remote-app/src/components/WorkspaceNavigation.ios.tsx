import { ScreenStack, ScreenStackItem } from 'react-native-screens'
import { colors } from '../theme'
import type { WorkspaceNavigationProps } from './WorkspaceNavigation'

export let WorkspaceNavigation = ({ sidebar, detail, selected, onBack }: WorkspaceNavigationProps) => <ScreenStack style={{ flex: 1 }}>
  <ScreenStackItem screenId="sessions" accessibilityElementsHidden={selected} activityState={selected ? 1 : 2} headerConfig={{ hidden: true }} contentStyle={{ flex: 1, backgroundColor: colors.bg }}>
    {sidebar}
  </ScreenStackItem>
  {selected && <ScreenStackItem screenId="browser" activityState={2} stackPresentation="push" stackAnimation="default" gestureEnabled fullScreenSwipeEnabled={false} hideKeyboardOnSwipe onDismissed={onBack} headerConfig={{ hidden: true }} contentStyle={{ flex: 1, backgroundColor: colors.bg }}>
    {detail}
  </ScreenStackItem>}
</ScreenStack>
