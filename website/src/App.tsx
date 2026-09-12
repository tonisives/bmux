import { DesignPreviews } from './DesignPreviews'
import { DocsPage } from './DocsPage'
import { SundayPage } from './SundayPage'

export let App = ({ pathname = '/' }: { pathname?: string }) => {
  if (pathname === '/docs' || pathname.startsWith('/docs/')) return <DocsPage pathname={pathname} />
  if (pathname.startsWith('/styles')) return <DesignPreviews pathname={pathname} />
  return <SundayPage />
}
