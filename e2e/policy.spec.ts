import { expect, test } from '@playwright/test'
import { scope, signUp, uniqueEmail } from './fixtures'

// The server runs examples/privacy: an organization's rules on top of id's own.

test.describe("the organization's policy", () => {
  test('is shown to anyone, in its own words and in full', async ({ page }) => {
    await page.goto('/policy')
    await expect(page.getByRole('heading', { name: 'Policy' })).toBeVisible()
    await expect(page.getByText('Example Club').first()).toBeVisible()
    await expect(page.getByText('Who may see and change an account', { exact: true })).toBeVisible()
    await expect(page.getByText('What a service may ask you for', { exact: true })).toBeVisible()

    // Each file of rules, and whose it is: the service's, or the organization's.
    await page.getByRole('button', { name: 'Read examples/privacy/fairgarden/id/privacy.rego' }).click()
    await expect(page.getByText('The organization’s')).toBeVisible()
    await expect(page.getByText('Only Members may ask where you live.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Read policies/id.rego' }).click()
    await expect(page.getByText(/^From id /)).toBeVisible()
  })

  test('is a resource anyone may read, now and as it was', async ({ request }) => {
    const current = await (await request.get('/api/v1alpha1/policies/current')).json()
    expect(current).toMatchObject({
      kind: 'Policy',
      metadata: { name: 'current' },
      spec: {
        engine: 'bundle',
        revision: expect.stringMatching(/\+[0-9a-f]{12}$/),
        organization: { organization: 'Example Club' },
        layers: [
          { path: 'policies', role: 'base', package: '@fairgarden-private/id' },
          { path: 'examples/privacy', role: 'organization' },
        ],
      },
      status: { phase: 'Active', signature: null },
    })

    // Its revision is kept as soon as it is loaded.
    await request.get('/api/v1alpha1/sessions/current')
    const revision = current.spec.revision as string
    const past = await request.get(`/api/v1alpha1/policies/${encodeURIComponent(revision)}`)
    expect(await past.json()).toMatchObject({ metadata: { name: revision }, spec: { revision } })

    const never = await request.get('/api/v1alpha1/policies/2020.01.01%2B000000000000')
    expect(never.status()).toBe(404)
    expect(await never.json()).toMatchObject({ kind: 'Status', reason: 'NotFound' })
  })

  test('keeps what it withholds from a service off the consent screen, and says why', async ({ page, request }) => {
    await signUp(page, request, { email: uniqueEmail('where'), scope: 'openid residential_address' })
    await expect(scope(page, 'Residential address')).toBeDisabled()
    await expect(page.getByText('Only Members may ask where you live.')).toBeVisible()
    await expect(page.getByText('Not Available to Mock Service')).toBeVisible()
    await expect(page.getByRole('link', { name: 'the policy' })).toHaveAttribute('href', /\/policy$/)
  })
})
