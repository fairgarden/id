import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '@fairgarden/id',
  description: 'Sign in to every FairGarden service, and decide what each one can see',
}

/**
 * Unstyled on purpose. The nav is here so every page has a way back, since the
 * pages themselves only cross-link within a section.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/">Home</Link> · <Link href="/overview">Overview</Link> ·{' '}
          <Link href="/api">API</Link> · <Link href="/commands">Commands</Link> ·{' '}
          <Link href="/configuration">Configuration</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  )
}
