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

test('history groups matching titled pages across query changes and trailing slashes', () => {
  let base = 'https://gfn.example.test/d/k8s_views_nodes/kubernetes-views-nodes'
  let first = `${base}?orgId=1&from=now-1h`
  let latest = `${base}/?orgId=1&from=now-6h`
  let title = 'Kubernetes / Views / Nodes - Grafana'
  let history = recordHistory([], first, title, 1)
  history = recordHistory(history, latest, title, 2)
  expect(history).toEqual([{ url: latest, title, visitedAt: 2 }])
  expect(searchHistory(history, 'kubernetes views nodes')).toEqual(history)
  expect(compactHistory([
    { url: latest, title, visitedAt: 2 },
    { url: first, title, visitedAt: 1 },
  ])).toEqual(history)
})

test('history keeps different titled pages on the same path and matching titles on other hosts', () => {
  let first = 'https://example.test/search?q=one'
  let second = 'https://example.test/search?q=two'
  let otherHost = 'https://other.test/search?q=two'
  let history = recordHistory([], first, 'One', 1)
  history = recordHistory(history, second, 'Two', 2)
  history = recordHistory(history, otherHost, 'Two', 3)
  expect(history.map(entry => entry.url)).toEqual([otherHost, second, first])
  expect(compactHistory(history)).toEqual(history)
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

test('Google Maps place IDs survive query URL changes; differently titled searches stay distinct', () => {
  let one = 'https://www.google.com/maps/search/?api=1&query=park&query_place_id=abc'
  let two = 'https://maps.google.com/maps/search/?query_place_id=abc&api=1&query=park'
  let history = recordHistory([], one, 'Park', 1)
  history = recordHistory(history, two, 'Park', 2)
  history = recordHistory(history, 'https://example.test/search?q=one', 'One', 3)
  history = recordHistory(history, 'https://example.test/search?q=two', 'Two', 4)
  expect(history.map(entry => entry.url)).toEqual(['https://example.test/search?q=two', 'https://example.test/search?q=one', two])
})

test('Google search history groups repeated visits despite changing tracking parameters', () => {
  let first = 'https://www.google.com/search?q=shell+directory+tool&udm=50&fbs=one'
  let latest = 'https://www.google.com/search?fbs=two&udm=50&q=shell+directory+tool'
  let otherMode = 'https://www.google.com/search?q=shell+directory+tool&udm=2'
  let otherQuery = 'https://www.google.com/search?q=other+tool&udm=50'
  let history = recordHistory([], first, 'shell directory tool - Google Search', 1)
  history = recordHistory(history, latest, latest, 2)
  history = recordHistory(history, otherMode, 'Images', 3)
  history = recordHistory(history, otherQuery, 'Other', 4)
  expect(history.map(entry => entry.url)).toEqual([otherQuery, otherMode, latest])
  expect(history[2]).toEqual({ url: latest, title: 'shell directory tool - Google Search', visitedAt: 2 })
  expect(compactHistory([
    { url: latest, title: latest, visitedAt: 2 },
    { url: first, title: 'shell directory tool - Google Search', visitedAt: 1 },
  ])).toEqual([{ url: latest, title: 'shell directory tool - Google Search', visitedAt: 2 }])
})

test('existing Google Maps history is compacted without changing other entries', () => {
  let viewport = { url: 'https://www.google.com/maps/@40.3,-73.4,15z', title: 'Google Maps', visitedAt: 5 }
  let latest = { url: 'https://www.google.com/maps/place/City+Park/@40.2,-73.3,18z', title: 'https://www.google.com/maps/place/City+Park/@40.2,-73.3,18z', visitedAt: 4 }
  let older = { url: 'https://www.google.com/maps/place/City+Park/@40.1,-73.2,17z', title: 'City Park - Google Maps', visitedAt: 2 }
  let other = { url: 'https://example.test/?q=one', title: 'One', visitedAt: 3 }
  expect(compactHistory([viewport, latest, other, older])).toEqual([{ ...latest, title: older.title }, other])
})
