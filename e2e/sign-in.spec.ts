import { expect, test } from '@playwright/test'
import {
  emailFor,
  expectSignInPage,
  finishSettingUp,
  mockClaims,
  MOCK,
  scope,
  signInWithEmail,
  signUp,
  startSignIn,
  uniqueEmail,
} from './fixtures'

test.describe('signing in by email', () => {
  test('a new person signs up with a code, and chooses what to share', async ({ page, request }) => {
    const email = uniqueEmail('signup')
    await signUp(page, request, { email, name: 'Ada Gardener', scope: 'openid email profile phone' })

    await expect(page.getByText(`Signed in as ${email}.`)).toBeVisible()
    await expect(scope(page, 'Your account ID')).toBeChecked()
    await expect(scope(page, 'Your account ID')).toBeDisabled()
    await expect(scope(page, 'Email address')).toBeChecked()
    await expect(scope(page, 'Name')).toBeChecked()
    // Sensitive, so never agreed to for them.
    await expect(scope(page, 'Phone number')).not.toBeChecked()
    await expect(page.getByText('Nothing added yet.')).toBeVisible()

    await page.getByRole('button', { name: 'Allow' }).click()
    await expect(page).toHaveURL(`${MOCK}/`)
    const claims = await mockClaims(page)
    expect(claims).toMatchObject({ email, email_verified: true, name: 'Ada Gardener', amr: ['otp'] })
    expect(claims).not.toHaveProperty('phone_number')
  })

  test('the emailed link signs in, in the browser that asked', async ({ page, request }) => {
    const email = uniqueEmail('link')
    await startSignIn(page)
    await page.getByLabel('Email Address').fill(email)
    await page.getByRole('button', { name: 'Email Me a Code' }).click()
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()

    const { link } = await emailFor(request, email)
    await page.goto(link)
    await finishSettingUp(page, 'Link Person')
    await expect(page.getByRole('heading', { name: 'Share with Mock Service?' })).toBeVisible()
    // The token does not linger in the address bar.
    expect(page.url()).not.toContain('token=')
  })

  test('the emailed link does nothing in another browser', async ({ page, request, browser }) => {
    const email = uniqueEmail('elsewhere')
    await startSignIn(page)
    await page.getByLabel('Email Address').fill(email)
    await page.getByRole('button', { name: 'Email Me a Code' }).click()
    const { link, code } = await emailFor(request, email)

    const elsewhere = await browser.newContext()
    const other = await elsewhere.newPage()
    await other.goto(link)
    await expect(other.getByRole('heading', { name: 'Continue in your other browser' })).toBeVisible()
    await elsewhere.close()

    // Nothing was used up: the code still works where it was asked for.
    await page.getByLabel('Code').fill(code)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()
  })

  test('a wrong code is refused, with the tries left', async ({ page, request }) => {
    const email = uniqueEmail('wrong')
    await startSignIn(page)
    await page.getByLabel('Email Address').fill(email)
    await page.getByRole('button', { name: 'Email Me a Code' }).click()
    const { code } = await emailFor(request, email)
    await page.getByLabel('Code').fill(code === '000000' ? '111111' : '000000')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText(/That code is not right. 4 tries left./)).toBeVisible()
  })

  test('someone already signed in is not asked again', async ({ page, request }) => {
    const email = uniqueEmail('again')
    await signUp(page, request, { email })
    await page.getByRole('button', { name: 'Allow' }).click()
    await mockClaims(page)

    await startSignIn(page)
    await expect(page).toHaveURL(`${MOCK}/`)
    expect(await mockClaims(page)).toMatchObject({ email })
  })

  test('cancelling tells the service no', async ({ page, request }) => {
    await signUp(page, request, { email: uniqueEmail('cancel') })
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('#error')).toHaveText('access_denied')
  })

  test('an existing account signs back in with a code, on a new device', async ({ page, request, browser }) => {
    const email = uniqueEmail('returning')
    await signUp(page, request, { email, name: 'Returning Person' })
    await page.getByRole('button', { name: 'Allow' }).click()
    await mockClaims(page)

    const device = await browser.newContext()
    const later = await device.newPage()
    await startSignIn(later)
    await expectSignInPage(later)
    await signInWithEmail(later, request, email)
    // Known already: no name to give, and the service was already allowed.
    await later.getByRole('button', { name: 'Not Now' }).click()
    expect(await mockClaims(later)).toMatchObject({ email, name: 'Returning Person' })
    await device.close()
  })
})
