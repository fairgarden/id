import { desc, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@fairgarden/id/lib/server/db'
import { emailCodes, mockMessages } from '@fairgarden/id/lib/server/schema'
import {
  pendingEmailChallenge,
  startEmailChallenge,
  verifyEmailCode,
  verifyEmailLink,
} from '@fairgarden/id/lib/server/sign-in'
import { useDatabase } from './helpers/database'

/** The code and token from the last mock email to this address. */
const lastEmail = async (to: string) => {
  const [message] = await (await db())
    .select()
    .from(mockMessages)
    .where(eq(mockMessages.to, to))
    .orderBy(desc(mockMessages.id))
    .limit(1)
  return {
    code: /(\d{6})/.exec(message.subject)![1],
    token: new URL(/https?:\/\/\S+/.exec(message.text)![0]).searchParams.get('token')!,
    text: message.text,
  }
}

let n = 0
const fresh = () => {
  n += 1
  return { uid: `interaction-${n}-${Date.now()}`, email: `person${n}@example.com` }
}

describe('signing in by email', () => {
  useDatabase()

  it('sends a code and a link to the sign-in that asked', async () => {
    const { uid, email } = fresh()
    const { expiresAt, resendAfter } = await startEmailChallenge(await db(), uid, email)
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60 * 1000)
    expect(resendAfter.getTime()).toBeGreaterThan(Date.now())

    const { code, token, text } = await lastEmail(email)
    expect(code).toMatch(/^\d{6}$/)
    expect(text).toContain(`/interaction/${uid}?token=`)
    expect(token.length).toBeGreaterThan(20)
    expect(await pendingEmailChallenge(await db(), uid)).toMatchObject({ email })
  })

  it('accepts the right code once', async () => {
    const { uid, email } = fresh()
    await startEmailChallenge(await db(), uid, email)
    const { code } = await lastEmail(email)
    expect(await verifyEmailCode(await db(), uid, code)).toBe(email)
    await expect(verifyEmailCode(await db(), uid, code)).rejects.toMatchObject({ code: 410 })
  })

  it('counts wrong guesses, and gives up after five', async () => {
    const { uid, email } = fresh()
    await startEmailChallenge(await db(), uid, email)
    const { code } = await lastEmail(email)
    const wrong = code === '000000' ? '111111' : '000000'

    await expect(verifyEmailCode(await db(), uid, wrong)).rejects.toMatchObject({
      code: 422,
      message: expect.stringContaining('4 tries left'),
    })
    for (let i = 0; i < 4; i++) await verifyEmailCode(await db(), uid, wrong).catch(() => undefined)
    await expect(verifyEmailCode(await db(), uid, code)).rejects.toMatchObject({ code: 429 })
  })

  it('only takes a code for the sign-in it was sent to', async () => {
    const one = fresh()
    const other = fresh()
    await startEmailChallenge(await db(), one.uid, one.email)
    const { code } = await lastEmail(one.email)
    await expect(verifyEmailCode(await db(), other.uid, code)).rejects.toMatchObject({ code: 410 })
  })

  it('binds the link to its sign-in, and uses it up', async () => {
    const { uid, email } = fresh()
    await startEmailChallenge(await db(), uid, email)
    const { token } = await lastEmail(email)
    await expect(verifyEmailLink(await db(), 'someone-elses', token)).rejects.toMatchObject({ code: 403 })
    expect(await verifyEmailLink(await db(), uid, token)).toBe(email)
    await expect(verifyEmailLink(await db(), uid, token)).rejects.toMatchObject({ code: 410 })
  })

  it('makes people wait before sending again, and only the newest email works', async () => {
    const { uid, email } = fresh()
    await startEmailChallenge(await db(), uid, email)
    const first = await lastEmail(email)
    await expect(startEmailChallenge(await db(), uid, email)).rejects.toMatchObject({
      code: 429,
      details: { retryAfterSeconds: expect.any(Number) },
    })

    // Pretend the wait is over.
    await (await db())
      .update(emailCodes)
      .set({ createdAt: sql`now() - interval '1 minute'` })
      .where(eq(emailCodes.interactionUid, uid))
    await startEmailChallenge(await db(), uid, email)
    const second = await lastEmail(email)
    expect(second.code === first.code && second.token === first.token).toBe(false)
    await expect(verifyEmailLink(await db(), uid, first.token)).rejects.toMatchObject({ code: 410 })
    expect(await verifyEmailLink(await db(), uid, second.token)).toBe(email)
  })
})
