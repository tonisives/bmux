import { describe, expect, it } from 'vitest'
import { hasWorkspaceSpace, workspaceLayout } from '../src/workspace-layout'

let division = (x: number, y: number, width: number, height: number) => [{ kind: 'division', frame: { x, y, width, height } }]
describe('adaptive workspace', () => {
  it('uses available width in either orientation and keeps narrow app windows compact', () => {
    for (let frame of [{ width: 900, height: 600 }, { width: 800, height: 1000 }, { width: 960, height: 390 }]) expect(workspaceLayout(frame).split).toBe(true)
    for (let width of [390, 469, 767]) expect(workspaceLayout({ width, height: 900 }).split).toBe(false)
    expect(hasWorkspaceSpace(840 - 84)).toBe(false)
    expect(hasWorkspaceSpace(852 - 84)).toBe(true)
  })
  it('puts columns on either side of a vertical fold', () => {
    expect(workspaceLayout({ width: 900, height: 600 }, division(430, 0, 28, 600))).toMatchObject({ split: true, direction: 'row', sidebarSize: 430, gap: 28, insetStart: 0, insetEnd: 0 })
  })
  it('stacks panels above and below a horizontal fold', () => {
    expect(workspaceLayout({ width: 600, height: 900 }, division(0, 430, 600, 28))).toMatchObject({ split: true, direction: 'column', sidebarSize: 430, gap: 28 })
  })
  it('keeps a compact viewer on the larger clear side', () => {
    expect(workspaceLayout({ width: 469, height: 600 }, division(120, 0, 28, 600))).toMatchObject({ split: false, insetStart: 148, insetEnd: 0 })
    expect(workspaceLayout({ width: 469, height: 600 }, division(330, 0, 28, 600))).toMatchObject({ split: false, insetStart: 0, insetEnd: 139 })
    expect(workspaceLayout({ width: 600, height: 400 }, division(0, 100, 600, 28))).toMatchObject({ split: false, direction: 'column', insetStart: 128 })
  })
  it('ignores occlusions and folds outside this workspace', () => {
    let frame = { width: 900, height: 600 }
    expect(workspaceLayout(frame, [{ kind: 'occlusion', frame: { x: 820, y: 0, width: 80, height: 100 } }])).toEqual(workspaceLayout(frame))
    expect(workspaceLayout(frame, division(1000, 0, 20, 600))).toEqual(workspaceLayout(frame))
  })
})
