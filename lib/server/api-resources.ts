import { GROUP_VERSION } from '@fairgarden-private/id/lib/api/group'
import { AccountPatch, AccountSpec } from '@fairgarden-private/id/lib/api/schemas'
import type * as api from '@fairgarden-private/id/lib/api/schemas'
import {
  formatAddress,
  updateProfile,
  type Account,
  type Passkey,
  type ProfileUpdate,
  type StoredAddress,
} from './accounts.ts'
import { mergePatch, parse } from './api-http.ts'
import type { Executor } from './db.ts'
import { ApiError } from './errors.ts'

/**
 * Between rows and the API's objects. The API speaks camelCase like any
 * Kubernetes resource; addresses are stored as the OIDC `address` claim, in
 * snake_case, because that is what gets released.
 */

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : undefined)

export const toApiAddress = (address: StoredAddress | null): api.Address | null =>
  address
    ? {
        ...(address.street_address ? { streetAddress: address.street_address } : {}),
        ...(address.locality ? { locality: address.locality } : {}),
        ...(address.region ? { region: address.region } : {}),
        ...(address.postal_code ? { postalCode: address.postal_code } : {}),
        ...(address.country ? { country: address.country } : {}),
        ...(address.formatted ? { formatted: address.formatted } : {}),
      }
    : null

const toStoredAddress = (address: api.Address | null): StoredAddress | null => {
  if (!address) return null
  const stored: StoredAddress = {
    ...(address.streetAddress ? { street_address: address.streetAddress } : {}),
    ...(address.locality ? { locality: address.locality } : {}),
    ...(address.region ? { region: address.region } : {}),
    ...(address.postalCode ? { postal_code: address.postalCode } : {}),
    ...(address.country ? { country: address.country } : {}),
  }
  return Object.keys(stored).length > 0 ? formatAddress(stored) : null
}

export const toApiAccount = (account: Account): api.Account => ({
  apiVersion: GROUP_VERSION,
  kind: 'Account',
  metadata: {
    name: account.id,
    creationTimestamp: iso(account.createdAt),
    resourceVersion: String(account.updatedAt.getTime()),
  },
  spec: {
    displayName: account.name,
    phoneNumber: account.phoneNumber,
    mailingAddress: toApiAddress(account.address),
    residentialAddress: toApiAddress(account.residentialAddress),
  },
  status: { email: account.email, emailVerified: account.emailVerified },
})

export const toProfileUpdate = (spec: api.AccountSpec): ProfileUpdate => ({
  name: spec.displayName,
  phoneNumber: spec.phoneNumber,
  address: toStoredAddress(spec.mailingAddress),
  residentialAddress: toStoredAddress(spec.residentialAddress),
})

export const toApiPasskey = (passkey: Passkey): api.Passkey => ({
  apiVersion: GROUP_VERSION,
  kind: 'Passkey',
  metadata: { name: passkey.id, creationTimestamp: iso(passkey.createdAt) },
  spec: { displayName: passkey.name },
  status: {
    deviceType: passkey.deviceType === 'multiDevice' ? 'multiDevice' : 'singleDevice',
    backedUp: passkey.backedUp,
    transports: passkey.transports,
    lastUsedTimestamp: iso(passkey.lastUsedAt) ?? null,
  },
})

/**
 * Apply a merge patch to an account's spec, refusing it if `resourceVersion`
 * says the caller saw an older account.
 */
export const patchAccount = async (
  database: Executor,
  account: Account,
  body: unknown
): Promise<api.Account> => {
  const patch = parse(AccountPatch, body)
  const version = patch.metadata?.resourceVersion
  if (version && version !== String(account.updatedAt.getTime())) {
    throw new ApiError(409, 'Conflict', 'Your account changed since you loaded it. Reload and try again.')
  }
  const merged = mergePatch(toApiAccount(account).spec, patch.spec ?? {}) as Record<string, unknown>
  // `formatted` is derived, whatever was sent.
  for (const key of ['mailingAddress', 'residentialAddress']) {
    const address = merged[key] as Record<string, unknown> | undefined
    if (address) delete address.formatted
  }
  const spec = parse(
    AccountSpec,
    { displayName: null, phoneNumber: null, mailingAddress: null, residentialAddress: null, ...merged },
    'spec'
  )
  return toApiAccount(await updateProfile(database, account.id, toProfileUpdate(spec)))
}

export const list = <K extends string, T>(kind: K, items: T[]) => ({
  apiVersion: GROUP_VERSION,
  kind,
  metadata: {},
  items,
})

export const success = (message: string, details?: api.Status['details']): api.Status => ({
  apiVersion: 'v1',
  kind: 'Status',
  metadata: {},
  status: 'Success',
  message,
  code: 200,
  ...(details ? { details } : {}),
})
