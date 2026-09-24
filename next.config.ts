import type { NextConfig } from 'next'
import { withMonolithicPortability } from '@fairgarden/monolith'
import { withFairGardenIndicators } from '@fairgarden/indicators/withFairGardenIndicators'
// With the extension: a monolith loads this file with Node itself, which
// resolves a relative import only when it has one.
import { indicators } from './lib/indicators.ts'

const nextConfig: NextConfig = {
  // oidc-provider names its models by their class names, which a production
  // bundle minifies; loaded by Node instead, every route shares one copy and
  // the names survive. A monolith has to carry the same entry.
  serverExternalPackages: ['oidc-provider'],
  redirects: async () => {
    return [
      {
        source: '/api/oidc',
        destination: '/oidc',
        permanent: true,
      },
      {
        source: '/api/oidc/:path*',
        destination: '/oidc/:path*',
        permanent: true,
      },
      {
        source: '/api/oidc/\\.well-known/openid-configuration',
        destination: '/.well-known/openid-configuration',
        permanent: true,
      },
      {
        source: '/oidc/\\.well-known/openid-configuration',
        destination: '/.well-known/openid-configuration',
        permanent: true,
      },
    ]
  },
  headers: async () => {
    // Pages where someone signs in or decides what to share: never framed,
    // and never telling another site where they came from, since a sign-in
    // link carries its token in the URL.
    const guarded = [
      '/interaction/:path*',
      '/account',
      '/sign-out',
      '/api/v1alpha1/:path*',
    ]
    return guarded.map((source) => ({
      source,
      headers: [
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ],
    }))
  },
  rewrites: async () => {
    return {
      beforeFiles: [
        {
          source: '/oidc',
          destination: '/api/oidc/[...path]',
        },
        {
          source: '/oidc/:path*',
          destination: '/api/oidc/:path*',
        },
        {
          source: '/\\.well-known/openid-configuration',
          destination: '/api/oidc/.well-known/openid-configuration',
        },
      ],
      afterFiles: [],
      fallback: [],
    }
  },
}

// The locale and theme go into the path — see lib/indicators.ts — after the
// OIDC rewrites above, and the portability check reports anything a monolith
// could not mount.
export default withMonolithicPortability(withFairGardenIndicators(nextConfig, indicators))
