import { describe, expect, it } from 'vitest'
import { findExtension } from '../src/main/extension-lookup'

let extension = (id: string, name: string) => ({ id, name })

describe('extension lookup', () => {
  let installed = [extension('bitwarden-id', 'Bitwarden Password Manager'), extension('fixture-id', 'Fixture extension')]

  it('matches an exact ID or full name', () => {
    expect(findExtension(installed, 'bitwarden-id')?.id).toBe('bitwarden-id')
    expect(findExtension(installed, 'BITWARDEN PASSWORD MANAGER')?.id).toBe('bitwarden-id')
  })

  it('matches a unique leading name such as the documented Bitwarden command', () => {
    expect(findExtension(installed, 'Bitwarden')?.id).toBe('bitwarden-id')
  })

  it('does not guess between duplicate name prefixes', () => {
    expect(findExtension([...installed, extension('second-id', 'Bitwarden Beta')], 'Bitwarden')).toBeUndefined()
  })
})
