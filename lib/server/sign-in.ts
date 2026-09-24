import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { getConfig } from './config.ts'
import type { Database } from './db.ts'
import { sendEmail, signInEmail } from './email.ts'
import { ApiError } from './errors.ts'
import { emailCodes } from './schema.ts'

/**
 * Signing in by email, the fallback for people without a passkey here yet.
 *
 * One email carries a six-digit code and a link. Both belong to the sign-in
 * that asked for them: the link only works in the browser holding that
 * sign-in's cookie, so a mail scanner opening it, or someone forwarded it,
 * gets nowhere, and the code is typed into that same sign-in. Only a hash of
 * either is stored, each is good once, and a code gets five guesses.
 */

const TTL_MINUTES = 15
const RESEND_SECONDS = 30
const MAX_PER_HOUR = 5
const MAX_ATTEMPTS = 5

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const codeHash = (interactionUid: string, code: string) => sha256(`${interactionUid}:${code}`)

const tooMany = (message: string, retryAfterSeconds: number) =>
  new ApiError(429, 'TooManyRequests', message, { retryAfterSeconds })

export const startEmailChallenge = async (
  database: Database,
  interactionUid: string,
  email: string
): Promise<{ expiresAt: Date; resendAfter: Date }> => {
  const [latest] = await database
    .select({ createdAt: emailCodes.createdAt })
    .from(emailCodes)
    .where(eq(emailCodes.interactionUid, interactionUid))
    .orderBy(desc(emailCodes.createdAt))
    .limit(1)
  if (latest) {
    const wait = RESEND_SECONDS - Math.floor((Date.now() - latest.createdAt.getTime()) / 1000)
    if (wait > 0) throw tooMany(`Wait ${wait} seconds before sending another email.`, wait)
  }

  const [{ recent }] = await database
    .select({ recent: count() })
    .from(emailCodes)
    .where(
      and(
        sql`lower(${emailCodes.email}) = ${email}`,
        gt(emailCodes.createdAt, sql`now() - interval '1 hour'`)
      )
    )
  if (recent >= MAX_PER_HOUR) {
    throw tooMany('Too many sign-in emails to that address. Try again in an hour.', 3600)
  }

  const token = randomBytes(32).toString('base64url')
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000)

  await database.transaction(async (tx) => {
    // Only the newest email for a sign-in works.
    await tx
      .update(emailCodes)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(emailCodes.interactionUid, interactionUid), isNull(emailCodes.consumedAt)))
    await tx.insert(emailCodes).values({
      id: sha256(token),
      email,
      interactionUid,
      codeHash: codeHash(interactionUid, code),
      expiresAt,
    })
  })

  const { issuer } = getConfig()
  // The page reads the token and proves it through the API, so the link does
  // nothing when merely fetched.
  const link = `${issuer}/interaction/${interactionUid}?token=${token}`
  await sendEmail(signInEmail({ to: email, code, link, minutes: TTL_MINUTES }))

  return { expiresAt, resendAfter: new Date(Date.now() + RESEND_SECONDS * 1000) }
}

export const pendingEmailChallenge = async (
  database: Database,
  interactionUid: string
): Promise<{ email: string; expiresAt: Date } | undefined> => {
  const [row] = await database
    .select({ email: emailCodes.email, expiresAt: emailCodes.expiresAt })
    .from(emailCodes)
    .where(
      and(
        eq(emailCodes.interactionUid, interactionUid),
        isNull(emailCodes.consumedAt),
        gt(emailCodes.expiresAt, sql`now()`)
      )
    )
    .orderBy(desc(emailCodes.createdAt))
    .limit(1)
  return row
}

const expired = () =>
  new ApiError(410, 'Expired', 'That sign-in email has expired or was already used. Send a new one.')

/** Mark it used, unless something else got there first. */
const consume = async (database: Database, id: string): Promise<string> => {
  const [row] = await database
    .update(emailCodes)
    .set({ consumedAt: sql`now()` })
    .where(and(eq(emailCodes.id, id), isNull(emailCodes.consumedAt)))
    .returning({ email: emailCodes.email })
  if (!row) throw expired()
  return row.email
}

/** The email address the code was sent to, once it is right. */
export const verifyEmailCode = async (
  database: Database,
  interactionUid: string,
  code: string
): Promise<string> => {
  const [row] = await database
    .update(emailCodes)
    .set({ attempts: sql`${emailCodes.attempts} + 1` })
    .where(
      eq(
        emailCodes.id,
        database
          .select({ id: emailCodes.id })
          .from(emailCodes)
          .where(
            and(
              eq(emailCodes.interactionUid, interactionUid),
              isNull(emailCodes.consumedAt),
              gt(emailCodes.expiresAt, sql`now()`)
            )
          )
          .orderBy(desc(emailCodes.createdAt))
          .limit(1)
      )
    )
    .returning()
  if (!row) throw expired()

  if (row.attempts > MAX_ATTEMPTS) {
    await consume(database, row.id).catch(() => undefined)
    throw new ApiError(429, 'TooManyRequests', 'Too many wrong codes. Send a new email.')
  }

  const matches = timingSafeEqual(
    Buffer.from(row.codeHash, 'hex'),
    Buffer.from(codeHash(interactionUid, code), 'hex')
  )
  if (!matches) {
    const left = MAX_ATTEMPTS - row.attempts
    throw new ApiError(422, 'Invalid', left > 0 ? `That code is not right. ${left} tries left.` : 'That code is not right.', {
      causes: [{ field: 'spec.code', reason: 'FieldValueInvalid', message: 'That code is not right.' }],
    })
  }
  return consume(database, row.id)
}

/** The email address the link was sent to, when this is the sign-in it was for. */
export const verifyEmailLink = async (
  database: Database,
  interactionUid: string,
  token: string
): Promise<string> => {
  const [row] = await database
    .select({ id: emailCodes.id, interactionUid: emailCodes.interactionUid })
    .from(emailCodes)
    .where(and(eq(emailCodes.id, sha256(token)), gt(emailCodes.expiresAt, sql`now()`)))
  if (!row) throw expired()
  if (row.interactionUid !== interactionUid) {
    throw new ApiError(403, 'Forbidden', 'That link is for a different sign-in.')
  }
  return consume(database, row.id)
}

