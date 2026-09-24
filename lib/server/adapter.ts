import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import type { Adapter, AdapterPayload } from 'oidc-provider'
import { db, type Executor } from './db.ts'
import { getConfig } from './config.ts'
import { challenges, emailCodes, mockMessages, oidc, policyDecisions } from './schema.ts'

/**
 * oidc-provider's storage: sessions, grants, codes, tokens and interactions,
 * one row each in `id_oidc`, told apart by `type` (the model name).
 *
 * Tokens that belong to a grant carry its ID, so revoking a grant — signing
 * out of a service, or the person removing its access — is one delete.
 */
export class PostgresAdapter implements Adapter {
  private readonly type: string

  constructor(type: string) {
    this.type = type
  }

  async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
    const database = await db()
    const row = {
      payload: payload as Record<string, unknown>,
      grantId: payload.grantId ?? null,
      userCode: payload.userCode ?? null,
      uid: payload.uid ?? null,
      expiresAt: Number.isFinite(expiresIn)
        ? sql`now() + ${Math.ceil(expiresIn)} * interval '1 second'`
        : null,
    }
    await database
      .insert(oidc)
      .values({ type: this.type, id, ...row })
      .onConflictDoUpdate({ target: [oidc.type, oidc.id], set: row })
    maybeSweep(database)
  }

  private async findBy(column: 'id' | 'uid' | 'userCode', value: string) {
    const database = await db()
    const [row] = await database
      .select({ payload: oidc.payload })
      .from(oidc)
      .where(
        and(
          eq(oidc.type, this.type),
          eq(oidc[column], value),
          or(isNull(oidc.expiresAt), gt(oidc.expiresAt, sql`now()`))
        )
      )
      .limit(1)
    return row?.payload as AdapterPayload | undefined
  }

  find(id: string) {
    return this.findBy('id', id)
  }

  findByUid(uid: string) {
    return this.findBy('uid', uid)
  }

  findByUserCode(userCode: string) {
    return this.findBy('userCode', userCode)
  }

  async consume(id: string): Promise<void> {
    const database = await db()
    await database
      .update(oidc)
      .set({
        payload: sql`${oidc.payload} || jsonb_build_object('consumed', extract(epoch from now())::integer)`,
      })
      .where(and(eq(oidc.type, this.type), eq(oidc.id, id)))
  }

  async destroy(id: string): Promise<void> {
    const database = await db()
    await database.delete(oidc).where(and(eq(oidc.type, this.type), eq(oidc.id, id)))
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    const database = await db()
    await database.delete(oidc).where(and(eq(oidc.type, this.type), eq(oidc.grantId, grantId)))
  }
}

/** Remove a grant and every token issued under it, whatever the model. */
export const revokeGrant = async (grantId: string): Promise<void> => {
  const database = await db()
  await database
    .delete(oidc)
    .where(or(eq(oidc.grantId, grantId), and(eq(oidc.type, 'Grant'), eq(oidc.id, grantId))))
}

/**
 * The grant a person already gave a service, from any session. oidc-provider
 * only looks in the current session, which would ask again on every new
 * device and leave a grant behind for each.
 */
export const findGrantId = async (accountId: string, clientId: string): Promise<string | undefined> => {
  const database = await db()
  const [row] = await database
    .select({ id: oidc.id })
    .from(oidc)
    .where(
      and(
        eq(oidc.type, 'Grant'),
        sql`${oidc.payload} ->> 'accountId' = ${accountId}`,
        sql`${oidc.payload} ->> 'clientId' = ${clientId}`,
        or(isNull(oidc.expiresAt), gt(oidc.expiresAt, sql`now()`))
      )
    )
    .orderBy(desc(sql`(${oidc.payload} ->> 'iat')::bigint`))
    .limit(1)
  return row?.id
}

export interface StoredGrant {
  id: string
  clientId: string
  scope: string
  rejectedScope: string
  issuedAt: number
}

/** The grants a person has given, for the account page. */
export const listGrants = async (accountId: string): Promise<StoredGrant[]> => {
  const database = await db()
  const rows = await database
    .select({ id: oidc.id, payload: oidc.payload })
    .from(oidc)
    .where(
      and(
        eq(oidc.type, 'Grant'),
        sql`${oidc.payload} ->> 'accountId' = ${accountId}`,
        or(isNull(oidc.expiresAt), gt(oidc.expiresAt, sql`now()`))
      )
    )
    .orderBy(desc(sql`(${oidc.payload} ->> 'iat')::bigint`))
  return rows.map(({ id, payload }) => {
    const openid = payload.openid as { scope?: string } | undefined
    const rejected = payload.rejected as { openid?: { scope?: string } } | undefined
    return {
      id,
      clientId: String(payload.clientId),
      scope: openid?.scope ?? '',
      rejectedScope: rejected?.openid?.scope ?? '',
      issuedAt: Number(payload.iat ?? 0),
    }
  })
}

/** Remove rows nothing will ask for again. */
export const sweepExpired = async (database: Executor): Promise<void> => {
  const hourAgo = sql`now() - interval '1 hour'`
  await database.delete(oidc).where(lt(oidc.expiresAt, hourAgo))
  await database.delete(emailCodes).where(lt(emailCodes.expiresAt, sql`now() - interval '1 day'`))
  await database.delete(challenges).where(lt(challenges.expiresAt, sql`now()`))
  await database
    .delete(mockMessages)
    .where(lt(mockMessages.createdAt, sql`now() - interval '7 days'`))
  const { retentionDays } = getConfig().policyLog
  await database
    .delete(policyDecisions)
    .where(lt(policyDecisions.decidedAt, sql`now() - ${retentionDays} * interval '1 day'`))
}

/** Sweep on roughly one write in a hundred, without making the caller wait. */
const maybeSweep = (database: Executor): void => {
  if (Math.random() >= 0.01) return
  sweepExpired(database).catch((error: unknown) =>
    console.error('[id] sweeping expired rows failed', error)
  )
}
