import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { mockClaims, MOCK, signUp, startSignIn, uniqueEmail, VirtualAuthenticator } from './fixtures'

test.describe('the account page', () => {
  test('signs in through the same flow, and asks nothing more', async ({ page, request }) => {
    await page.goto('/account')
    await page.getByRole('link', { name: 'Sign In' }).click()
    await expect(page.getByRole('heading', { name: /^Sign in to / })).toBeVisible()
    const email = uniqueEmail('account')
    await page.getByLabel('Email Address').fill(email)
    await page.getByRole('button', { name: 'Email Me a Code' }).click()
    const list = await (await request.get('/api/v1alpha1/mockmessages')).json()
    const message = list.items.find((item: { spec: { to: string } }) => item.spec.to === email)
    await page.getByLabel('Code').fill(/(\d{6})/.exec(message.spec.subject)![1])
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Your Name').fill('Account Holder')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Not Now' }).click()

    await expect(page).toHaveURL(/\/account/)
    await expect(page.getByRole('heading', { name: 'Account Holder' })).toBeVisible()
    await expect(page.getByText('You have not signed in to any services yet.')).toBeVisible()
  })

  test('keeps details, and refuses what is not a phone number', async ({ page, request }) => {
    await signUp(page, request, { email: uniqueEmail('details') })
    await page.getByRole('button', { name: 'Allow' }).click()
    await mockClaims(page)

    await page.goto('/account')
    await page.getByLabel('Phone Number').fill('call me')
    await page.getByRole('button', { name: 'Save Details' }).click()
    await expect(page.getByText('Enter a phone number, like +1 555 010 0000').first()).toBeVisible()

    await page.getByLabel('Phone Number').fill('+64 21 555 0100')
    await page.getByLabel('Street Address').first().fill('1 Garden Way')
    await page.getByLabel('City or Town').first().fill('Leafton')
    await page.getByLabel('Country').first().fill('NZ')
    await page.getByRole('checkbox', { name: 'Same as My Mailing Address' }).check()
    await page.getByRole('button', { name: 'Save Details' }).click()
    await expect(page.getByText('Saved.')).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Phone Number')).toHaveValue('+64 21 555 0100')
    await expect(page.getByLabel('City or Town').first()).toHaveValue('Leafton')
    await expect(page.getByRole('checkbox', { name: 'Same as My Mailing Address' })).toBeChecked()
  })

  test('removing a service’s access revokes it, and it has to ask again', async ({ page, request }) => {
    await signUp(page, request, { email: uniqueEmail('revoke') })
    await page.getByRole('button', { name: 'Allow' }).click()
    await mockClaims(page)
    expect(await (await page.request.get(`${MOCK}/userinfo`)).json()).toMatchObject({ status: 200 })

    await page.goto('/account')
    const services = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Connected services' }) })
    const service = services.getByRole('listitem').filter({ hasText: 'Mock Service' })
    await expect(service.getByText('Email address')).toBeVisible()
    await service.getByRole('button', { name: 'Remove Access' }).click()
    await expect(page.getByText('You have not signed in to any services yet.')).toBeVisible()

    expect(await (await page.request.get(`${MOCK}/userinfo`)).json()).toMatchObject({ status: 401 })
    await startSignIn(page)
    await expect(page.getByRole('heading', { name: 'Share with Mock Service?' })).toBeVisible()
  })

  test('adds, renames and removes passkeys', async ({ page, request }) => {
    const authenticator = await VirtualAuthenticator.attach(page)
    await signUp(page, request, { email: uniqueEmail('keys') })
    await page.getByRole('button', { name: 'Allow' }).click()
    await mockClaims(page)

    await page.goto('/account')
    await expect(page.getByText('No passkeys yet.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Add a Passkey' }).click()
    const row = page.getByRole('listitem').filter({ hasText: 'Added' })
    await expect(row).toBeVisible()
    expect(await authenticator.credentials()).toHaveLength(1)

    await row.getByRole('button', { name: 'Rename' }).click()
    await page.getByLabel('Passkey Name').fill('My laptop')
    await page.getByRole('button', { name: 'Save Name' }).click()
    await expect(page.getByText('My laptop')).toBeVisible()

    await page.getByRole('listitem').filter({ hasText: 'My laptop' }).getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByText('No passkeys yet.', { exact: false })).toBeVisible()
  })

  test('shows what policy decided about the person, from the audit log', async ({ page, request }) => {
    await signUp(page, request, { email: uniqueEmail('decisions'), scope: 'openid email club' })
    await page.getByRole('button', { name: 'Allow' }).click()
    const { sub } = await mockClaims(page)

    await page.goto('/account')
    await expect(
      page.getByText('Mock Service was allowed to ask for Your account ID, Email address, Club. Policy offered all of it.')
    ).toBeVisible()

    const list = await (await page.request.get('/api/v1alpha1/policydecisions')).json()
    expect(list.kind).toBe('PolicyDecisionList')
    expect(list.items.length).toBeGreaterThan(1)
    // Only this person's decisions, each as it was recorded, under the revision that made it.
    for (const item of list.items) {
      expect((item.spec.input as { user: { name: string } }).user.name).toBe(sub)
      expect(item.status).toMatchObject({ engine: 'bundle', revision: expect.stringMatching(/\+[0-9a-f]{12}$/), error: null })
    }
    const kinds = new Set(list.items.map((item: { spec: { decision: string } }) => item.spec.decision))
    expect(kinds).toEqual(new Set(['authz', 'release']))

    const releases = await (
      await page.request.get('/api/v1alpha1/policydecisions?fieldSelector=spec.decision=release')
    ).json()
    expect(releases.items.every((item: { spec: { decision: string } }) => item.spec.decision === 'release')).toBe(true)

    // The export an auditor would run, against this server's database.
    const exported = execFileSync(
      process.execPath,
      [path.resolve(import.meta.dirname, '..', 'lib', 'server', 'cli.ts'), 'policy', 'log', '--subject', String(sub), '--decision', 'release'],
      {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: { ...process.env, FG_ID_DATA_DIR: 'e2e/.data', FG_ID_EMBEDDED_DATABASE_PORT: '54410' },
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    )
      .toString()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(exported.map((entry) => entry.input.purpose)).toEqual(expect.arrayContaining(['Preview', 'Consent']))
    expect(exported[0]).toMatchObject({ path: 'fairgarden/id/release', labels: { service: 'id' } })

    // Each decision leads to the rules that made it.
    const revision = list.items[0].status.revision as string
    await page.getByRole('link', { name: `Policy ${revision}` }).first().click()
    await expect(page).toHaveURL(/\/policy\?revision=/)
    await expect(page.getByText(`Revision ${revision}`, { exact: false })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Read the policy in force now' })).toBeVisible()
  })

  test('signing out ends the session, after asking', async ({ page, request }) => {
    await signUp(page, request, { email: uniqueEmail('signout') })
    await page.getByRole('button', { name: 'Allow' }).click()
    await mockClaims(page)

    await page.getByRole('link', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Sign out?' })).toBeVisible()
    await expect(page.getByText('Mock Service asked to sign you out.')).toBeVisible()
    await page.getByRole('button', { name: 'Sign Out' }).click()
    await expect(page).toHaveURL(`${MOCK}/`)
    await expect(page.locator('#signed-out')).toBeVisible()

    // Signed out here too: signing in asks who it is again.
    await startSignIn(page)
    await expect(page.getByRole('heading', { name: 'Sign in to Mock Service' })).toBeVisible()
  })
})
