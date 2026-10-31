import type { Frame } from './viewport'

type Region = { kind: string; frame: Frame & { x: number; y: number } }
export let hasWorkspaceSpace = (width: number) => width >= 768

export let workspaceLayout = ({ width, height }: Frame, regions: readonly Region[] = []) => {
  let split = hasWorkspaceSpace(width)
  let fold = regions.find(region => region.kind === 'division' && region.frame.x < width && region.frame.y < height &&
    region.frame.x + region.frame.width >= 0 && region.frame.y + region.frame.height >= 0 && (
    (region.frame.height >= height * 0.8 && region.frame.width < region.frame.height) ||
    (region.frame.width >= width * 0.8 && region.frame.height < region.frame.width)
  ))?.frame
  let vertical = !fold || fold.height > fold.width
  let extent = vertical ? width : height
  let start = fold ? Math.max(0, Math.min(extent, vertical ? fold.x : fold.y)) : 0
  let end = fold ? Math.max(start, Math.min(extent, vertical ? fold.x + fold.width : fold.y + fold.height)) : 0
  let leading = start, trailing = extent - end
  if (fold) split = vertical ? leading >= 240 && trailing >= 320 : width >= 320 && leading >= 200 && trailing >= 240
  // A narrow window keeps its active page on the larger side of the fold.
  let insetStart = fold && !split && trailing > leading ? end : 0
  let insetEnd = fold && !split && leading >= trailing ? extent - start : 0
  return {
    split,
    direction: vertical ? 'row' as const : 'column' as const,
    sidebarSize: fold && split ? start : Math.min(340, width * 0.45),
    gap: fold && split ? end - start : 0,
    insetStart,
    insetEnd,
  }
}
