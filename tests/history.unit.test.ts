import { expect, test } from 'vitest'
import { recordHistory } from '../src/shared/history'
import { searchHistory } from '../src/shared/picker-search'

test('history keeps a page title across later URL-only updates', () => {
  let url = 'https://gfn.example.test/d/k8s_views_nodes/kubernetes-views-nodes?orgId=1'
  let history = recordHistory([], url, url, 1)
  history = recordHistory(history, url, 'Kubernetes / Views / Nodes - Grafana', 2)
  history = recordHistory(history, url, url, 3)
  expect(history).toEqual([{ url, title: 'Kubernetes / Views / Nodes - Grafana', visitedAt: 3 }])
  expect(searchHistory(history, 'Node')).toEqual(history)
})
