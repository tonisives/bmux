import { expect, it } from 'vitest'
import { extensionDetails } from '../src/shared/extension-details'

it('separates required, optional, and content script access across manifest versions', () => {
  expect(extensionDetails({
    manifest_version: 2, description: 'Example', permissions: ['tabs', 'https://example.com/*', 'tabs'],
    host_permissions: ['https://example.com/*', '<all_urls>'], optional_permissions: ['bookmarks', 'file:///*'],
    optional_host_permissions: ['https://optional.example/*'], content_scripts: [{ matches: ['https://content.example/*'] }, { matches: ['https://content.example/*'] }]
  })).toEqual({
    description: 'Example', manifestVersion: 2, permissions: ['tabs'], hostPermissions: ['https://example.com/*', '<all_urls>'],
    optionalPermissions: ['bookmarks'], optionalHostPermissions: ['file:///*', 'https://optional.example/*'],
    contentScriptMatches: ['https://content.example/*'], manifestAvailable: true
  })
})

it('distinguishes an unavailable manifest from an extension without permissions', () => {
  expect(extensionDetails(null)).toMatchObject({ manifestAvailable: false, permissions: [], hostPermissions: [] })
  expect(extensionDetails({ manifest_version: 3 })).toMatchObject({ manifestAvailable: true, permissions: [], hostPermissions: [] })
  expect(extensionDetails({ permissions: [null, 1, {}, 'storage'], content_scripts: [null, {}] })).toMatchObject({ permissions: ['storage'], contentScriptMatches: [] })
})
