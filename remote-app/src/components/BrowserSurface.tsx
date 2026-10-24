import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, PanResponder, StyleSheet, Text, View } from 'react-native'
import type { ViewProps, GestureResponderEvent } from 'react-native'
import { Video } from './Video'
import { colors } from '../theme'
import { contentRect, identityTransform, pagePoint, pinchTransform } from '../viewport'
import type { Frame, Transform } from '../viewport'
import type { Viewport } from '../types'

type Input = { type: string; x: number; y: number; button?: string; clickCount?: number; deltaX?: number; deltaY?: number }
type Touch = { locationX: number; locationY: number; pageX: number; pageY: number }
export let BrowserSurface = ({ stream, viewport, controlling, busy, input, frameChanged }: { stream?: MediaStream; viewport?: Viewport; controlling: boolean; busy: boolean; input: (event: Input, generation: number) => void; frameChanged: (frame: Frame) => void }) => {
  let [frame, setFrame] = useState<Frame>({ width: 1, height: 1 })
  let [transform, setTransform] = useState<Transform>(identityTransform)
  let current = useRef({ frame, transform, viewport, controlling, input })
  current.current = { frame, transform, viewport, controlling, input }
  let gesture = useRef<{ x: number; y: number; lastX: number; lastY: number; generation: number; dragged: boolean; moved: boolean; transform: Transform; distance?: number; center?: { x: number; y: number }; timer?: ReturnType<typeof setTimeout> } | undefined>(undefined)
  let emit = (event: Input, generation: number) => {
    let value = current.current
    if (value.controlling && value.viewport?.generation === generation) value.input(event, generation)
  }
  let cancel = () => {
    let active = gesture.current
    if (!active) return
    clearTimeout(active.timer)
    if (active.dragged && current.current.viewport) {
      let point = pagePoint({ x: active.lastX, y: active.lastY }, current.current.frame, current.current.viewport, current.current.transform)
      if (point) emit({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 }, active.generation)
    }
    gesture.current = undefined
  }
  useEffect(() => { cancel(); setTransform(identityTransform) }, [viewport?.generation, controlling, stream])
  useEffect(() => () => cancel(), [])
  let responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event: GestureResponderEvent) => {
      cancel()
      let value = current.current
      let touch = event.nativeEvent
      let active = { x: touch.locationX, y: touch.locationY, lastX: touch.locationX, lastY: touch.locationY, generation: value.viewport?.generation ?? 0, dragged: false, moved: false, transform: value.transform } as NonNullable<typeof gesture.current>
      gesture.current = active
      if (value.controlling && value.viewport && event.nativeEvent.touches.length < 2) active.timer = setTimeout(() => {
        if (gesture.current !== active || active.moved || !current.current.viewport) return
        let point = pagePoint({ x: active.x, y: active.y }, value.frame, value.viewport!, value.transform)
        if (point) { active.dragged = true; emit({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 }, active.generation) }
      }, 450)
    },
    onPanResponderMove: event => {
      let active = gesture.current, value = current.current
      if (!active || !value.viewport) return
      let touches = event.nativeEvent.touches as unknown as Touch[]
      if (touches.length >= 2) {
        clearTimeout(active.timer)
        if (active.dragged) { cancel(); active.dragged = false; gesture.current = active }
        let a = touches[0], b = touches[1]
        let distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY)
        if (distance === 0) return
        let center = { x: (a.locationX + b.locationX) / 2, y: (a.locationY + b.locationY) / 2 }
        if (!active.distance) { active.distance = distance; active.center = center; active.transform = value.transform }
        active.moved = true
        setTransform(pinchTransform(value.frame, active.transform, active.center!, center, distance / active.distance))
        return
      }
      if (active.distance) return
      let x = event.nativeEvent.locationX, y = event.nativeEvent.locationY
      if (Math.hypot(x - active.x, y - active.y) > 8) { active.moved = true; clearTimeout(active.timer) }
      if (!value.controlling) setTransform({ ...active.transform, x: active.transform.x + x - active.x, y: active.transform.y + y - active.y })
      else if (active.moved || active.dragged) {
        let point = pagePoint({ x, y }, value.frame, value.viewport, value.transform)
        if (point) {
          if (active.dragged) emit({ type: 'mouseMove', ...point, button: 'left' }, active.generation)
          else {
            let rect = contentRect(value.frame, value.viewport)
            emit({ type: 'mouseWheel', ...point, deltaX: (active.lastX - x) / (rect.scale * value.transform.zoom), deltaY: (active.lastY - y) / (rect.scale * value.transform.zoom) }, active.generation)
          }
        }
      }
      active.lastX = x; active.lastY = y
    },
    onPanResponderRelease: event => {
      let active = gesture.current, value = current.current
      if (active && !active.moved && !active.dragged && value.controlling && value.viewport) {
        let point = pagePoint({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }, value.frame, value.viewport, value.transform)
        if (point) {
          emit({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 }, active.generation)
          emit({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 }, active.generation)
        }
      }
      cancel()
    },
    onPanResponderTerminate: cancel,
  }), [])
  let wheel = {
    onWheel: (event: { nativeEvent: { deltaX: number; deltaY: number; clientX: number; clientY: number }; currentTarget: { getBoundingClientRect: () => { left: number; top: number } } }) => {
      let value = current.current
      if (!value.viewport || !value.controlling) return
      let bounds = event.currentTarget.getBoundingClientRect()
      let point = pagePoint({ x: event.nativeEvent.clientX - bounds.left, y: event.nativeEvent.clientY - bounds.top }, value.frame, value.viewport, value.transform)
      if (point) emit({ type: 'mouseWheel', ...point, deltaX: event.nativeEvent.deltaX, deltaY: event.nativeEvent.deltaY }, value.viewport.generation)
    },
  } as ViewProps
  return <View accessibilityLabel="Remote browser viewport" style={local.surface} onLayout={event => { let { width, height } = event.nativeEvent.layout; setFrame({ width, height }); frameChanged({ width, height }) }} {...wheel}>
    {stream && <View style={[StyleSheet.absoluteFill, { transform: [{ translateX: transform.x }, { translateY: transform.y }, { scale: transform.zoom }] }]}><Video stream={stream} /></View>}
    <View style={StyleSheet.absoluteFill} {...responder.panHandlers} />
    {busy && <View pointerEvents="none" style={local.loading}><ActivityIndicator color={colors.accent} /><Text style={local.caption}>Connecting…</Text></View>}
    {!busy && !stream && <View pointerEvents="none" style={local.loading}><Text style={local.caption}>Open a page to watch</Text></View>}
  </View>
}
let local = StyleSheet.create({
  surface: { flex: 1, backgroundColor: '#000000', overflow: 'hidden', minHeight: 200 },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12 },
  caption: { color: colors.secondary, fontSize: 14 },
})
