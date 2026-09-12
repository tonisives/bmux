import { DesignPreviews } from './DesignPreviews'
import { SundayPage } from './SundayPage'

export let App = ({ pathname = '/' }: { pathname?: string }) => {
  if (pathname.startsWith('/styles')) return <DesignPreviews pathname={pathname} />
  return <SundayPage />
}
