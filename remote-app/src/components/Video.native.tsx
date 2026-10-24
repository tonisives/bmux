import { StyleSheet } from 'react-native'
import { RTCView } from 'react-native-webrtc'

export let Video = ({ stream }: { stream: MediaStream }) => <RTCView streamURL={(stream as unknown as { toURL: () => string }).toURL()} objectFit="contain" style={local.video} />
let local = StyleSheet.create({ video: { width: '100%', height: '100%' } })
