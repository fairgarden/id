import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { and, eq, gt, sql } from 'drizzle-orm'
import {
  addPasskey,
  findPasskey,
  listPasskeys,
  recordPasskeyUse,
  type Account,
  type Passkey,
} from './accounts.ts'
import { getConfig } from './config.ts'
import type { Executor } from './db.ts'
import { ApiError } from './errors.ts'
import { challenges } from './schema.ts'

/**
 * Passkeys, through @simplewebauthn — the WebAuthn ceremony and nothing else.
 *
 * Every challenge is stored under a key naming what it is for (a sign-in, or
 * a person adding a passkey) and taken out when answered, so each can be
 * answered once. Signing in asks for a discoverable credential, so a person
 * does not have to say who they are first.
 */

const CHALLENGE_TTL_SECONDS = 5 * 60

const storeChallenge = async (database: Executor, key: string, challenge: string) => {
  const expiresAt = sql`now() + ${CHALLENGE_TTL_SECONDS} * interval '1 second'`
  await database
    .insert(challenges)
    .values({ id: key, challenge, expiresAt })
    .onConflictDoUpdate({ target: challenges.id, set: { challenge, expiresAt } })
  return new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000)
}

const takeChallenge = async (database: Executor, key: string): Promise<string> => {
  const [row] = await database
    .delete(challenges)
    .where(and(eq(challenges.id, key), gt(challenges.expiresAt, sql`now()`)))
    .returning({ challenge: challenges.challenge })
  if (!row) {
    throw new ApiError(410, 'Expired', 'That passkey request expired. Try again.')
  }
  return row.challenge
}

const relyingParty = () => {
  const { passkeys, brand } = getConfig()
  return { rpID: passkeys.rpId, rpName: brand.name, origins: passkeys.origins }
}

export const authenticationOptions = async (
  database: Executor,
  key: string
): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; expiresAt: Date }> => {
  const { rpID } = relyingParty()
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' })
  const expiresAt = await storeChallenge(database, key, options.challenge)
  return { options, expiresAt }
}

export const verifyAuthentication = async (
  database: Executor,
  key: string,
  credential: AuthenticationResponseJSON
): Promise<{ passkey: Passkey; userVerified: boolean }> => {
  const expectedChallenge = await takeChallenge(database, key)
  const passkey = await findPasskey(database, credential.id)
  if (!passkey) {
    throw new ApiError(404, 'NotFound', 'That passkey is not registered here. Sign in with email instead.', {
      kind: 'Passkey',
      name: credential.id,
    })
  }

  const { rpID, origins } = relyingParty()
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      credential: {
        id: passkey.id,
        publicKey: Buffer.from(passkey.publicKey, 'base64url'),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: false,
    })
  } catch (error) {
    throw new ApiError(401, 'Unauthorized', `The passkey could not be verified: ${(error as Error).message}`)
  }
  if (!verification.verified) {
    throw new ApiError(401, 'Unauthorized', 'The passkey could not be verified.')
  }

  const { newCounter, credentialBackedUp, userVerified } = verification.authenticationInfo
  await recordPasskeyUse(database, passkey.id, newCounter, credentialBackedUp)
  return { passkey, userVerified }
}

export const registrationOptions = async (
  database: Executor,
  key: string,
  account: Account
): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; expiresAt: Date }> => {
  const { rpID, rpName } = relyingParty()
  const existing = await listPasskeys(database, account.id)
  const options = await generateRegistrationOptions({
    rpID,
    rpName,
    userID: new TextEncoder().encode(account.id),
    userName: account.email,
    userDisplayName: account.name ?? account.email,
    attestationType: 'none',
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.id,
      transports: passkey.transports,
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  })
  const expiresAt = await storeChallenge(database, key, options.challenge)
  return { options, expiresAt }
}

/** A name to start with, from the browser that made it; people can rename it. */
const nameFromUserAgent = (userAgent: string | undefined, synced: boolean): string => {
  const ua = userAgent ?? ''
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : undefined
  if (!device) return synced ? 'Synced passkey' : 'Passkey'
  return synced ? `Passkey synced from ${device}` : `Passkey on ${device}`
}

export const verifyRegistration = async (
  database: Executor,
  key: string,
  account: Account,
  credential: RegistrationResponseJSON,
  { displayName, userAgent }: { displayName?: string; userAgent?: string }
): Promise<Passkey> => {
  const expectedChallenge = await takeChallenge(database, key)
  const { rpID, origins } = relyingParty()
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: false,
    })
  } catch (error) {
    throw new ApiError(400, 'BadRequest', `The passkey could not be registered: ${(error as Error).message}`)
  }
  if (!verification.verified) {
    throw new ApiError(400, 'BadRequest', 'The passkey could not be registered.')
  }

  const info = verification.registrationInfo
  if (await findPasskey(database, info.credential.id)) {
    throw new ApiError(409, 'AlreadyExists', 'That passkey is already registered.')
  }
  return addPasskey(database, {
    id: info.credential.id,
    accountId: account.id,
    publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
    counter: info.credential.counter,
    transports: info.credential.transports ?? [],
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    name: displayName ?? nameFromUserAgent(userAgent, info.credentialDeviceType === 'multiDevice'),
  })
}
