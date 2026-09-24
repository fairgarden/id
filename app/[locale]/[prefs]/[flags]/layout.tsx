import type { Metadata } from 'next'
import { ClientProvider } from '@fairgarden/design/utils/ClientProvider'
import '@fairgarden/design/utils/global.css'
import '@fairgarden/design/utils/fonts'
import { indicators } from '@fairgarden-private/id/lib/indicators'

import './icons.css'
import styles from './layout.module.css'

// Read when the pages are built, so a white-label deployment names itself by
// setting FG_ID_NAME before its build.
const name = process.env.FG_ID_NAME ?? 'Fair Garden'

export const metadata: Metadata = {
  title: { default: name, template: `%s · ${name}` },
  description: `Sign in to ${name}, and choose what each service can see.`,
  robots: { index: false, follow: false },
}

// Every locale, theme and flag combination, so each variant of every page
// below is prerendered. Anything else renders on demand and is cached.
export const generateStaticParams = indicators.generateStaticParams

/**
 * The root layout sits below all three indicator segments so the theme can
 * go on <html>, where the design system reads it: `data-theme` forces a
 * mode, and leaving it off follows the OS.
 */
export default indicators.layout(({ children, locale, prefs }) => (
  <html lang={locale} data-theme={prefs.theme}>
    <body className={styles.body}>
      <ClientProvider locale={locale}>{children}</ClientProvider>
    </body>
  </html>
))
