export type BuildInfo = { version: string; revision: string; builtAt: string }

declare let __BMUX_BUILD_INFO__: BuildInfo
export let buildInfo: BuildInfo | undefined = typeof __BMUX_BUILD_INFO__ === 'undefined' ? undefined : __BMUX_BUILD_INFO__
