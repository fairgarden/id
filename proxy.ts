import { createLocaleProxy } from '@fairgarden/indicators/proxy'
import { indicators } from '@fairgarden-private/id/lib/indicators'

// Negotiates the locale at the site root only; every other path is a
// rewrite. Not mounted by a monolith, which runs its own for each app.
export const proxy = createLocaleProxy(indicators)

// Written out rather than taken from `proxy.matcher`: Next reads this from
// the source at build time.
export const config = { matcher: ['/'] }
