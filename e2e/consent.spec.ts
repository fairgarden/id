import { expect, test } from '@playwright/test'
import { mockClaims, MOCK, scope, signUp, uniqueEmail } from './fixtures'

interface Review {
  purpose: string
  subject: string
  client: { id: string }
  scopes: string[]
}

const reviewsFor = async (request: import('@playwright/test').APIRequestContext, subject: string) =>
  (await (await request.get(`${MOCK}/club/reviews?subject=${subject}`)).json()) as Review[]

test.describe('claims another service keeps', () => {
  test('are shown before anything is shared, and not shared unless chosen', async ({ page, request }) => {
    await signUp(page, request, { email: uniqueEmail('club-no'), scope: 'openid club' })

    const club = scope(page, 'Club')
    await expect(club).not.toBeChecked()
    const details = page.getByText('level: gold')
    await expect(details).toBeVisible()
    await expect(page.getByText('Not shared: Handicaps stay in the clubhouse.')).toBeVisible()
    await expect(page.getByText('From Club')).toBeVisible()

    await page.getByRole('button', { name: 'Allow' }).click()
    const claims = await mockClaims(page)
    expect(claims).not.toHaveProperty('club')

    // Asked for a preview while deciding, and never for the real thing.
    const reviews = await reviewsFor(request, String(claims.sub))
    expect(reviews.map((review) => review.purpose)).toEqual(['Preview'])
    expect(reviews[0]).toMatchObject({ client: { id: 'mock' }, scopes: ['club'] })
  })

  test('are passed on, fresh from the service that keeps them, once chosen', async ({ page, request }) => {
    await signUp(page, request, { email: uniqueEmail('club-yes'), scope: 'openid club' })
    await scope(page, 'Club').check()
    await page.getByRole('button', { name: 'Allow' }).click()

    const claims = await mockClaims(page)
    expect(claims.club).toEqual({ level: 'gold', since: '2020-01-01' })
    const userinfo = JSON.parse((await page.locator('#userinfo').textContent())!)
    expect(userinfo.club).toEqual({ level: 'gold', since: '2020-01-01' })

    const purposes = (await reviewsFor(request, String(claims.sub))).map((review) => review.purpose)
    expect(purposes[0]).toBe('Preview')
    expect(purposes.slice(1).every((purpose) => purpose === 'Release')).toBe(true)
    expect(purposes.length).toBeGreaterThan(1)
  })

  test('a sensitive scope ticked is shared, with what was on file', async ({ page, request }) => {
    await signUp(page, request, { email: uniqueEmail('phone'), scope: 'openid phone address' })
    await expect(scope(page, 'Mailing address')).not.toBeChecked()
    await scope(page, 'Phone number').check()
    await page.getByRole('button', { name: 'Allow' }).click()
    // Nothing on file yet, so there is nothing to release, only the right to.
    const claims = await mockClaims(page)
    expect(claims).not.toHaveProperty('phone_number')
    expect(claims).not.toHaveProperty('address')
  })

  test('asked again, a scope refused before can be shared after all', async ({ page, request }) => {
    const asked = 'openid email phone'
    await signUp(page, request, { email: uniqueEmail('again'), scope: asked })
    await expect(scope(page, 'Phone number')).not.toBeChecked()
    await page.getByRole('button', { name: 'Allow' }).click()
    await mockClaims(page)

    // The service asks again: everything it asks for, ticked as answered last time.
    await page.goto(`${MOCK}/login?scope=${encodeURIComponent(asked)}&prompt=consent`)
    await expect(page.getByRole('heading', { name: 'Share with Mock Service?' })).toBeVisible()
    await expect(scope(page, 'Email address')).toBeChecked()
    await expect(scope(page, 'Phone number')).not.toBeChecked()
    await scope(page, 'Phone number').check()
    await page.getByRole('button', { name: 'Allow' }).click()
    await mockClaims(page)

    await page.goto('/account')
    const services = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Connected services' }) })
    const service = services.getByRole('listitem').filter({ hasText: 'Mock Service' })
    await expect(service.getByText('Phone number')).toBeVisible()
    await expect(service.getByText(/You declined/)).toHaveCount(0)
  })
})
