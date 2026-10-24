import { useLocalSearchParams } from 'expo-router'
import { RemoteApp } from '../../src/RemoteApp'
export let AttentionPage = () => {
  let { id } = useLocalSearchParams<{ id: string }>()
  return <RemoteApp attentionId={id} />
}
export { AttentionPage as default }
