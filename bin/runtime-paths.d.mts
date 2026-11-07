export let runtimeDataDirectory: (platform: string, home: string, env: Record<string, string | undefined>) => string
export let developmentExecutable: (root: string, platform: string) => string
export let macAppCandidates: (home: string) => string[]
