import path from 'node:path'
import { policySourceFromEnv, type PolicySource } from '@fairgarden/policy'

/**
 * Everything this service is told by its environment.
 *
 * Read on first use rather than at import, because a monolith and `next build`
 * both load server modules long before a request supplies the real
 * environment. Loaded natively by the key CLI as well, so it keeps to syntax
 * Node can strip and imports its neighbours with their extension.
 */

const PACKAGE_NAME = '@fairgarden/id'

/** The OIDC client the account page signs in with. Never listed as a service. */
export const ACCOUNT_CLIENT_ID = 'fg-id-account'

/** Scopes this service answers for itself, which no service can take over. */
export const OWN_SCOPES = [
  'openid',
  'email',
  'profile',
  'phone',
  'address',
  'residential_address',
  'offline_access',
] as const

/** Claims this service issues itself, which no service can supply. */
export const OWN_CLAIMS = [
  'sub',
  'amr',
  'email',
  'email_verified',
  'name',
  'updated_at',
  'phone_number',
  'phone_number_verified',
  'address',
  'residential_address',
] as const

export interface Service {
  /** The OIDC `client_id`. */
  id: string
  /** Shown on the consent screen and in the account's connected services. */
  name: string
  /** Where the service lives, which its other URLs default from. */
  url: string | undefined
  /** Absent for a public client, which then has to use PKCE. */
  secret: string | undefined
  redirectUris: string[]
  postLogoutRedirectUris: string[]
  /**
   * Scopes whose claims this service supplies, and the claims in each. The
   * service is asked for them — a `ClaimsReview` sent to its webhook — each
   * time a person has agreed to release them to another service.
   */
  claims: Record<string, string[]>
  /** The claims webhook. Defaults to `<url>/api/v1alpha1/claimsreviews`. */
  claimsEndpoint: string | undefined
  /** Any other client metadata, passed to oidc-provider as is. */
  metadata: Record<string, unknown>
}

export interface Config {
  /** The OIDC issuer: the public URL plus wherever a monolith mounted this app. */
  issuer: string
  /** Scheme, host and port of the issuer. */
  origin: string
  /** The monolith mount point, or `''` when running on its own. */
  mount: string
  brand: { name: string }
  /** Postgres connection string. Absent, an embedded database is used. */
  databaseUrl: string | undefined
  /** Where the embedded database keeps its files. */
  dataDir: string
  /** The local port the embedded database is served on. */
  embeddedDatabasePort: number
  email: {
    from: string
    smtpUrl: string | undefined
    /** Messages go to the mock mailbox rather than out. */
    mock: boolean
  }
  passkeys: { rpId: string; origins: string[] }
  keys: {
    /** Signing keys from the environment, which turns automatic rotation off. */
    jwks: { keys: JsonWebKeyWithKid[] } | undefined
    /** Cookie secrets from the environment, newest first. */
    cookieSecrets: string[] | undefined
    rotationDays: number
  }
  services: Service[]
  /**
   * The organization's policy (`FG_POLICY_*`, shared by every service), or
   * undefined for the built-in rules; and the Rego package holding this
   * service's rules, as a path.
   */
  policy: { source: PolicySource | undefined; package: string }
  /** How long decisions are kept, and whether they also go to standard output. */
  policyLog: { retentionDays: number; stdout: boolean }
}

export type JsonWebKeyWithKid = JsonWebKey & { kid: string; alg?: string; use?: string }

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

const env = (name: string): string | undefined => {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)

const trimSlash = (value: string): string => value.replace(/\/+$/, '')

/**
 * Where a monolith mounted this app.
 *
 * `process.env.MONOLITH_MOUNTS` is written out in full because Next only
 * substitutes a literal member access, and a monolith passes this through its
 * `env` config.
 */
export const mountPath = (): string => {
  try {
    const mounts = JSON.parse(process.env.MONOLITH_MOUNTS ?? '{}') as Record<string, string>
    return mounts[PACKAGE_NAME] ?? ''
  } catch {
    return ''
  }
}

/**
 * The public URL, before any mount point.
 *
 * `FG_ID_URL` is what a white-label deployment sets. Without it, a Vercel
 * deployment uses its own domain and anything else is local development.
 */
const publicUrl = (): string => {
  const configured = env('FG_ID_URL')
  if (configured) {
    let url: URL
    try {
      url = new URL(configured)
    } catch {
      throw new ConfigError(`FG_ID_URL must be an absolute URL, got ${JSON.stringify(configured)}`)
    }
    return trimSlash(`${url.origin}${url.pathname}`)
  }
  const production = env('VERCEL_PROJECT_PRODUCTION_URL')
  if (env('VERCEL_ENV') === 'production' && production) return `https://${production}`
  const deployment = env('VERCEL_URL')
  if (deployment) return `https://${deployment}`
  return `http://localhost:${env('PORT') ?? '3010'}`
}

const isLocalHost = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '127.0.0.1' ||
  hostname === '[::1]'

/** `membership:membership,roles profile:nickname` -> { membership: [...], profile: [...] } */
const parseClaims = (service: string, value: string | undefined): Record<string, string[]> => {
  const claims: Record<string, string[]> = {}
  for (const group of (value ?? '').split(/[\s;]+/).filter(Boolean)) {
    const [scope, names = scope] = group.split(':')
    if (!scope || !/^[a-z0-9_.-]+$/i.test(scope)) {
      throw new ConfigError(`FG_ID_SERVICE_${service}_CLAIMS has an invalid scope in ${JSON.stringify(group)}`)
    }
    if ((OWN_SCOPES as readonly string[]).includes(scope)) {
      throw new ConfigError(
        `FG_ID_SERVICE_${service}_CLAIMS claims the "${scope}" scope, which this service answers for itself`
      )
    }
    const claimNames = list(names)
    for (const claim of claimNames) {
      if ((OWN_CLAIMS as readonly string[]).includes(claim)) {
        throw new ConfigError(
          `FG_ID_SERVICE_${service}_CLAIMS supplies the "${claim}" claim, which this service issues itself`
        )
      }
    }
    claims[scope] = claimNames
  }
  return claims
}

const parseMetadata = (service: string, value: string | undefined): Record<string, unknown> => {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // reported below
  }
  throw new ConfigError(`FG_ID_SERVICE_${service}_METADATA must be a JSON object`)
}

const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .split(/[_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

/**
 * Services enrolled through the environment, one group of variables each:
 *
 * ```
 * FG_ID_SERVICE_MEMBERS_URL=https://members.example.com
 * FG_ID_SERVICE_MEMBERS_SECRET=...
 * ```
 *
 * A service is named by a variable ending in `_URL`, or `_REDIRECT_URIS` for
 * one without a site of its own, such as a native app. No other variable of a
 * service may end in either.
 */
export const parseServices = (
  source: Record<string, string | undefined> = process.env
): Service[] => {
  const names = new Set<string>()
  for (const key of Object.keys(source)) {
    const match = /^FG_ID_SERVICE_([A-Z0-9_]+?)_(URL|REDIRECT_URIS)$/.exec(key)
    if (match && source[key]?.trim()) names.add(match[1])
  }

  const services: Service[] = []
  for (const name of [...names].sort()) {
    const get = (field: string) => source[`FG_ID_SERVICE_${name}_${field}`]?.trim() || undefined
    const url = get('URL') ? trimSlash(get('URL')!) : undefined
    const redirectUris = list(get('REDIRECT_URIS'))
    if (redirectUris.length === 0) {
      if (!url) throw new ConfigError(`FG_ID_SERVICE_${name} needs a URL or REDIRECT_URIS`)
      redirectUris.push(`${url}/auth/callback`)
    }
    const postLogoutRedirectUris = list(get('LOGOUT_URIS'))
    if (postLogoutRedirectUris.length === 0 && url) postLogoutRedirectUris.push(url)

    const claims = parseClaims(name, get('CLAIMS'))
    const claimsEndpoint =
      get('CLAIMS_ENDPOINT') ??
      (Object.keys(claims).length > 0 && url ? `${url}/api/v1alpha1/claimsreviews` : undefined)
    if (Object.keys(claims).length > 0 && !claimsEndpoint) {
      throw new ConfigError(`FG_ID_SERVICE_${name}_CLAIMS needs a URL or CLAIMS_ENDPOINT to ask`)
    }

    services.push({
      id: get('ID') ?? name.toLowerCase().replace(/_/g, '-'),
      name: get('NAME') ?? titleCase(name),
      url,
      secret: get('SECRET'),
      redirectUris,
      postLogoutRedirectUris,
      claims,
      claimsEndpoint,
      metadata: parseMetadata(name, get('METADATA')),
    })
  }

  const seen = new Map<string, number>()
  for (const scope of services.flatMap((service) => Object.keys(service.claims))) {
    seen.set(scope, (seen.get(scope) ?? 0) + 1)
  }
  for (const [scope, count] of seen) {
    if (count > 1) throw new ConfigError(`More than one service supplies the "${scope}" scope`)
  }
  const ids = services.map((service) => service.id)
  if (new Set(ids).size !== ids.length || ids.includes(ACCOUNT_CLIENT_ID)) {
    throw new ConfigError('Two services share a client ID, or one uses a reserved ID')
  }

  return services
}

/** `FG_ID_JWKS` as JSON, or as base64url JSON for environments that mangle it. */
const parseJwks = (value: string | undefined): Config['keys']['jwks'] => {
  if (!value) return undefined
  const text = /^[[{]/.test(value) ? value : Buffer.from(value, 'base64url').toString('utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ConfigError('FG_ID_JWKS must be a JWK Set, as JSON or base64url JSON')
  }
  const keys = (Array.isArray(parsed) ? parsed : (parsed as { keys?: unknown }).keys) as
    | JsonWebKeyWithKid[]
    | undefined
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new ConfigError('FG_ID_JWKS has no keys')
  }
  for (const key of keys) {
    if (!key.kid || !key.d) {
      throw new ConfigError('Every key in FG_ID_JWKS needs a "kid" and its private part')
    }
  }
  return { keys }
}

const policySettings = (): Config['policy'] => {
  try {
    return {
      source: policySourceFromEnv(),
      package: (env('FG_ID_POLICY_PACKAGE') ?? 'fairgarden/id').replace(/\./g, '/'),
    }
  } catch (error) {
    throw new ConfigError((error as Error).message)
  }
}

let cached: Config | undefined

export const getConfig = (): Config => {
  if (cached) return cached

  const mount = mountPath()
  const issuer = `${publicUrl()}${mount}`
  const { origin, hostname } = new URL(issuer)
  const brandName = env('FG_ID_NAME') ?? 'Fair Garden'
  const smtpUrl = env('FG_ID_SMTP_URL')

  const rotationDays = Number(env('FG_ID_KEY_ROTATION_DAYS') ?? 30)
  if (!Number.isFinite(rotationDays) || rotationDays <= 0) {
    throw new ConfigError('FG_ID_KEY_ROTATION_DAYS must be a positive number of days')
  }

  cached = {
    issuer,
    origin,
    mount,
    brand: { name: brandName },
    databaseUrl: env('FG_ID_DATABASE_URL') ?? env('DATABASE_URL') ?? env('POSTGRES_URL'),
    // Only for the embedded development database; not traced into a build.
    dataDir: path.resolve(/* turbopackIgnore: true */ env('FG_ID_DATA_DIR') ?? path.join('.data', 'id')),
    embeddedDatabasePort: Number(env('FG_ID_EMBEDDED_DATABASE_PORT') ?? 54310),
    email: {
      from: env('FG_ID_EMAIL_FROM') ?? `${brandName} <no-reply@${hostname}>`,
      smtpUrl,
      // Never on a public host unless asked for: anyone could read the
      // sign-in links in the mailbox.
      mock: !smtpUrl && (isLocalHost(hostname) || env('FG_ID_MOCK_EMAIL') === 'true'),
    },
    passkeys: {
      rpId: env('FG_ID_PASSKEY_RP_ID') ?? hostname,
      origins: [origin, ...list(env('FG_ID_PASSKEY_ORIGINS'))],
    },
    keys: {
      jwks: parseJwks(env('FG_ID_JWKS')),
      cookieSecrets: env('FG_ID_COOKIE_SECRETS') ? list(env('FG_ID_COOKIE_SECRETS')) : undefined,
      rotationDays,
    },
    services: parseServices(),
    policy: policySettings(),
    policyLog: {
      retentionDays: Number(env('FG_ID_POLICY_LOG_RETENTION_DAYS') ?? 400),
      stdout: env('FG_ID_POLICY_LOG_STDOUT') === 'true',
    },
  }
  return cached
}
