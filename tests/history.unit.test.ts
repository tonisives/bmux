import { expect, test } from 'vitest'
import { compactHistory, recordHistory } from '../src/shared/history'
import { searchHistory } from '../src/shared/picker-search'

test('history keeps a page title across later URL-only updates', () => {
  let url = 'https://gfn.example.test/d/k8s_views_nodes/kubernetes-views-nodes?orgId=1'
  let history = recordHistory([], url, url, 1)
  history = recordHistory(history, url, 'Kubernetes / Views / Nodes - Grafana', 2)
  history = recordHistory(history, url, url, 3)
  expect(history).toEqual([{ url, title: 'Kubernetes / Views / Nodes - Grafana', visitedAt: 3 }])
  expect(searchHistory(history, 'Node')).toEqual(history)
})

test('Google Maps keeps one reopenable entry per place and ignores map movement', () => {
  let first = 'https://www.google.com/maps/place/City+Park/@40.1,-73.2,17z/data=!4m2'
  let moved = 'https://www.google.com/maps/place/City+Park/@40.2,-73.3,18z/data=!4m3?entry=ttu'
  let viewport = 'https://www.google.com/maps/@40.3,-73.4,15z?entry=ttu'
  let history = recordHistory([], viewport, 'Google Maps', 1)
  expect(history).toEqual([])
  history = recordHistory(history, first, 'City Park - Google Maps', 2)
  history = recordHistory(history, moved, moved, 3)
  history = recordHistory(history, viewport, 'Google Maps', 4)
  expect(history).toEqual([{ url: moved, title: 'City Park - Google Maps', visitedAt: 3 }])
  expect(searchHistory(history, 'maps city')).toEqual(history)
})

test('Google Maps place IDs survive query URL changes; other sites retain meaningful queries', () => {
  let one = 'https://www.google.com/maps/search/?api=1&query=park&query_place_id=abc'
  let two = 'https://maps.google.com/maps/search/?query_place_id=abc&api=1&query=park'
  let history = recordHistory([], one, 'Park', 1)
  history = recordHistory(history, two, 'Park', 2)
  history = recordHistory(history, 'https://example.test/search?q=one', 'One', 3)
  history = recordHistory(history, 'https://example.test/search?q=two', 'Two', 4)
  expect(history.map(entry => entry.url)).toEqual(['https://example.test/search?q=two', 'https://example.test/search?q=one', two])
})

test('existing Google Maps history is compacted without changing other entries', () => {
  let viewport = { url: 'https://www.google.com/maps/@40.3,-73.4,15z', title: 'Google Maps', visitedAt: 5 }
  let latest = { url: 'https://www.google.com/maps/place/City+Park/@40.2,-73.3,18z', title: 'https://www.google.com/maps/place/City+Park/@40.2,-73.3,18z', visitedAt: 4 }
  let older = { url: 'https://www.google.com/maps/place/City+Park/@40.1,-73.2,17z', title: 'City Park - Google Maps', visitedAt: 2 }
  let other = { url: 'https://example.test/?q=one', title: 'One', visitedAt: 3 }
  expect(compactHistory([viewport, latest, other, older])).toEqual([{ ...latest, title: older.title }, other])
})
