import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@fairgarden-private/id/lib/server/db'
import { describeKeys, loadKeys, rotateNow } from '@fairgarden-private/id/lib/server/keys'
import { useDatabase } from './helpers/database'

const DAY = 24 * 60 * 60 * 1000
const kids = (set: Awaited<ReturnType<typeof loadKeys>>) => set.jwks.keys.map((key) => key.kid)

describe('keys kept in the database', () => {
  useDatabase()
  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates a signing key and a cookie secret on first use, then keeps them', async () => {
    const first = await loadKeys(await db())
    expect(first.jwks.keys).toHaveLength(1)
    expect(first.jwks.keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' })
    expect(first.jwks.keys[0].d).toBeTruthy()
    expect(first.cookieKeys).toHaveLength(1)
    expect(await loadKeys(await db())).toEqual(first)
  })

  it('publishes the next key a day before signing with it, and keeps three', async () => {
    const start = Date.now()
    const initial = kids(await loadKeys(await db()))
    vi.useFakeTimers({ toFake: ['Date'] })

    vi.setSystemTime(start + 31 * DAY)
    const rotated = kids(await loadKeys(await db()))
    expect(rotated).toHaveLength(2)
    // Published, but the old key still signs.
    expect(rotated[0]).toBe(initial[0])

    vi.setSystemTime(start + 32 * DAY + 60_000)
    const signing = kids(await loadKeys(await db()))
    expect(signing[0]).not.toBe(initial[0])
    expect(signing).toContain(initial[0])

    vi.setSystemTime(start + 70 * DAY)
    await loadKeys(await db())
    vi.setSystemTime(start + 110 * DAY)
    const later = kids(await loadKeys(await db()))
    expect(later).toHaveLength(3)
    expect(later).not.toContain(initial[0])
  })

  it('signs with a new key at once when told to, retiring the old ones on request', async () => {
    const before = kids(await loadKeys(await db()))
    const { kid, retired } = await rotateNow(await db(), { retire: true })
    expect(retired).toEqual(expect.arrayContaining(before))
    const after = await describeKeys(await db())
    const signing = after.filter((key) => key.use === 'sig')
    expect(signing).toEqual([expect.objectContaining({ kid, signing: true })])
  })
})
