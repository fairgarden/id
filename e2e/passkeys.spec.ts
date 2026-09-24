import { generateKeyPairSync } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  expectSignInPage,
  mockClaims,
  MOCK,
  signInWithEmail,
  startSignIn,
  uniqueEmail,
  VirtualAuthenticator,
} from './fixtures'

test.describe('passkeys', () => {
  test('added after an email sign-in, then used alone on another device', async ({ page, request, browser }) => {
    const authenticator = await VirtualAuthenticator.attach(page)
    const email = uniqueEmail('passkey')

    await startSignIn(page)
    await expectSignInPage(page)
    await signInWithEmail(page, request, email)
    await page.getByLabel('Your Name').fill('Key Holder')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Add a Passkey' }).click()
    await page.getByRole('button', { name: 'Allow' }).click()
    expect(await mockClaims(page)).toMatchObject({ email, amr: ['otp'] })

    const [credential] = await authenticator.credentials()
    expect(credential).toMatchObject({ isResidentCredential: true, rpId: 'localhost' })

    // A second device, which has the passkey (it syncs) but no session.
    const device = await browser.newContext()
    const second = await device.newPage()
    await (await VirtualAuthenticator.attach(second)).add(credential)
    await startSignIn(second)
    // The browser offers the passkey in the email field's autofill, and a
    // virtual authenticator takes the offer by itself; otherwise the button.
    await expect(async () => {
      if (second.url().startsWith(MOCK)) return
      await second.getByRole('button', { name: 'Sign In With a Passkey' }).click({ timeout: 1_000 })
    }).toPass()

    // No email, no name, no consent: the passkey is proof, and the service
    // was already allowed.
    await expect(second).toHaveURL(`${MOCK}/`)
    const claims = await mockClaims(second)
    expect(claims).toMatchObject({ email, name: 'Key Holder' })
    expect(claims.amr).toEqual(expect.arrayContaining(['pop']))
    await device.close()
  })

  test('a passkey nobody registered is refused, and email still works', async ({ page, request }) => {
    const stranger = await VirtualAuthenticator.attach(page)
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    await stranger.add({
      credentialId: Buffer.from('never-registered').toString('base64'),
      isResidentCredential: true,
      rpId: 'localhost',
      privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
      userHandle: Buffer.from('nobody').toString('base64'),
      signCount: 0,
    })
    await startSignIn(page)
    // Autofill may try it before the button does; either way it is refused.
    await expect(async () => {
      const refused = page.getByText('That passkey is not registered here. Sign in with email instead.')
      if (await refused.isVisible()) return
      await page.getByRole('button', { name: 'Sign In With a Passkey' }).click({ timeout: 1_000 })
      await expect(refused).toBeVisible({ timeout: 2_000 })
    }).toPass()

    await signInWithEmail(page, request, uniqueEmail('fallback'))
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()
  })
})
