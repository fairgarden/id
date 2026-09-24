import { createIndicators } from '@fairgarden/indicators'

/**
 * What goes into the path for every page of this app.
 *
 * `/login` is the English login page. A `theme` cookie of `light` or `dark`
 * selects a variant rendered with that theme on `<html>`, and each variant
 * is prerendered — see `generateStaticParams` in the root layout. Without
 * the cookie the page follows the OS through `prefers-color-scheme`.
 *
 * Also imported by `next.config.ts` and `proxy.ts`, so keep this free of
 * anything that only runs in a request.
 */
export const indicators = createIndicators({
  locales: ['en'],
  defaultLocale: 'en',
  prefs: {
    theme: { values: ['light', 'dark'] },
  },
  flags: {},
  // The OIDC endpoints are served at the site root, outside the locale tree.
  exclude: ['oidc'],
})
