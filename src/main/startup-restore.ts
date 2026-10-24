type StartupRestore = { lazyRestore: boolean; backgroundStartup: boolean; backgroundProfile: boolean; keepAlive?: boolean; deferBackground: boolean }

export let shouldDeferStartupPane = (options: StartupRestore) => options.lazyRestore && !options.keepAlive && (!options.backgroundProfile || options.backgroundStartup && options.deferBackground)
