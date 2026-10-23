export type BuildInfo = { revision: string; builtAt: string }

declare let __BMUX_BUILD_INFO__: BuildInfo
export let buildInfo: BuildInfo | undefined = typeof __BMUX_BUILD_INFO__ === 'undefined' ? undefined : __BMUX_BUILD_INFO__

export let buildIdInset = (showBuildId?: boolean, statusBar?: string) => showBuildId && statusBar !== 'bottom' ? 18 : 0
