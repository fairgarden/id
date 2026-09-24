import type { Account } from './accounts.ts'
import { getConfig, type Service } from './config.ts'

/**
 * What each scope releases, in the words a person is asked to agree to.
 *
 * A sensitive scope is never ticked for them on the consent screen: they
 * have to choose to share it, every time a new service asks. Scopes supplied
 * by another service are treated the same way, since the data is not ours to
 * hand out without being asked.
 */
export interface ScopeInfo {
  name: string
  title: string
  description: string
  claims: string[]
  sensitive: boolean
  /** Always granted; the service cannot work without it. */
  required: boolean
  /** The service that supplies the claims, for a delegated scope. */
  source: Service | undefined
}

const OWN: Array<Omit<ScopeInfo, 'source'>> = [
  {
    name: 'openid',
    title: 'Your account ID',
    description: 'Lets it recognise you when you come back.',
    // How they signed in: `pop` (and `mfa`) for a passkey, `otp` for email.
    claims: ['sub', 'amr'],
    sensitive: false,
    required: true,
  },
  {
    name: 'email',
    title: 'Email address',
    description: 'Your verified email address.',
    claims: ['email', 'email_verified'],
    sensitive: false,
    required: false,
  },
  {
    name: 'profile',
    title: 'Name',
    description: 'The name you gave us.',
    claims: ['name', 'updated_at'],
    sensitive: false,
    required: false,
  },
  {
    name: 'phone',
    title: 'Phone number',
    description: 'Your phone number.',
    claims: ['phone_number', 'phone_number_verified'],
    sensitive: true,
    required: false,
  },
  {
    name: 'address',
    title: 'Mailing address',
    description: 'Where you receive post.',
    claims: ['address'],
    sensitive: true,
    required: false,
  },
  {
    name: 'residential_address',
    title: 'Residential address',
    description: 'Where you live.',
    claims: ['residential_address'],
    sensitive: true,
    required: false,
  },
  {
    name: 'offline_access',
    title: 'Stay connected',
    description: 'Keep access while you are not using it, until you remove it.',
    claims: [],
    sensitive: false,
    required: false,
  },
]

const titleCase = (value: string): string =>
  value
    .split(/[_.-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

export const scopeCatalog = (): ScopeInfo[] => {
  const delegated = getConfig().services.flatMap((service) =>
    Object.entries(service.claims).map(
      ([name, claims]): ScopeInfo => ({
        name,
        title: titleCase(name),
        description: `Details ${service.name} keeps about you.`,
        claims,
        sensitive: true,
        required: false,
        source: service,
      })
    )
  )
  return [...OWN.map((scope) => ({ ...scope, source: undefined })), ...delegated]
}

export const scopeInfo = (name: string): ScopeInfo =>
  scopeCatalog().find((scope) => scope.name === name) ?? {
    name,
    title: titleCase(name),
    description: 'Access the service asked for.',
    claims: [],
    sensitive: true,
    required: false,
    source: undefined,
  }

/** oidc-provider's `claims` setting: which claims each scope releases. */
export const claimsByScope = (): Record<string, string[]> =>
  Object.fromEntries(
    scopeCatalog()
      .filter((scope) => scope.name !== 'offline_access')
      .map((scope) => [scope.name, scope.claims])
  )

/** What a person would be sharing, shown beside each scope on the consent screen. */
export const previewOwnScope = (scope: string, account: Account): string[] | undefined => {
  switch (scope) {
    case 'email':
      return [account.email]
    case 'profile':
      return account.name ? [account.name] : []
    case 'phone':
      return account.phoneNumber ? [account.phoneNumber] : []
    case 'address':
      return account.address?.formatted ? account.address.formatted.split('\n') : []
    case 'residential_address':
      return account.residentialAddress?.formatted
        ? account.residentialAddress.formatted.split('\n')
        : []
    default:
      return undefined
  }
}
