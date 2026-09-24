import { expect, type APIRequestContext, type CDPSession, type Page } from '@playwright/test'
import type { MockMessageList } from '@fairgarden-private/id/lib/api/schemas'

/** The mock service the tests sign in to; see mock-service.ts. */
export const MOCK = 'http://localhost:3111'

let count = 0
/** An address nobody else in the run has used, so tests never share a person. */
export const uniqueEmail = (label: string) =>
  `${label}-${Date.now().toString(36)}-${process.pid}-${(count += 1)}@example.com`

/** The newest email to `to` in the mock mailbox, once it has arrived. */
export const emailFor = async (request: APIRequestContext, to: string) => {
  let found: MockMessageList['items'][number] | undefined
  await expect
    .poll(async () => {
      const list = (await (await request.get('/api/v1alpha1/mockmessages')).json()) as MockMessageList
      found = list.items.find((message) => message.spec.to === to)
      return Boolean(found)
    })
    .toBe(true)
  return {
    code: /(\d{6})/.exec(found!.spec.subject)![1],
    link: /https?:\/\/\S+/.exec(found!.spec.text)![0],
  }
}

/** Ask the mock service to sign in, and land on the id service's sign-in page. */
export const startSignIn = async (page: Page, scope = 'openid email profile') => {
  await page.goto(`${MOCK}/login?scope=${encodeURIComponent(scope)}`)
}

export const expectSignInPage = async (page: Page) => {
  await expect(page.getByRole('heading', { name: 'Sign in to Mock Service' })).toBeVisible()
}

/** From the sign-in page: email a code, and type it in. */
export const signInWithEmail = async (page: Page, request: APIRequestContext, email: string) => {
  await page.getByLabel('Email Address').fill(email)
  await page.getByRole('button', { name: 'Email Me a Code' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  const { code } = await emailFor(request, email)
  await page.getByLabel('Code').fill(code)
  await page.getByRole('button', { name: 'Continue' }).click()
}

/** A new account's name, then no passkey for now. */
export const finishSettingUp = async (page: Page, name: string) => {
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()
  await page.getByLabel('Your Name').fill(name)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in faster next time' })).toBeVisible()
  await page.getByRole('button', { name: 'Not Now' }).click()
}

/** Sign up through the mock service, as far as the consent screen. */
export const signUp = async (
  page: Page,
  request: APIRequestContext,
  { email, name = 'Test Person', scope }: { email: string; name?: string; scope?: string }
) => {
  await startSignIn(page, scope)
  await expectSignInPage(page)
  await signInWithEmail(page, request, email)
  await finishSettingUp(page, name)
  await expect(page.getByRole('heading', { name: 'Share with Mock Service?' })).toBeVisible()
}

/** A consent screen checkbox, by the scope's title. */
export const scope = (page: Page, title: string) =>
  page.getByRole('checkbox', { name: new RegExp(`^${title}`) })

/** What the mock service was told about the person, once it has been. */
export const mockClaims = async (page: Page) => {
  await expect(page.locator('#signed-in')).toBeVisible()
  return JSON.parse((await page.locator('#claims').textContent())!) as Record<string, unknown>
}

interface Credential {
  credentialId: string
  isResidentCredential: boolean
  rpId?: string
  privateKey: string
  userHandle?: string
  signCount: number
}

/**
 * Chromium's virtual authenticator: a platform authenticator that says yes to
 * every prompt. Moving its credentials to another page's authenticator is how
 * a synced passkey reaches a second device.
 */
export class VirtualAuthenticator {
  private constructor(
    private readonly session: CDPSession,
    private readonly id: string
  ) {}

  static async attach(page: Page) {
    const session = await page.context().newCDPSession(page)
    await session.send('WebAuthn.enable')
    const { authenticatorId } = await session.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    })
    return new VirtualAuthenticator(session, authenticatorId)
  }

  async credentials(): Promise<Credential[]> {
    const { credentials } = await this.session.send('WebAuthn.getCredentials', { authenticatorId: this.id })
    return credentials as Credential[]
  }

  async add(credential: Credential) {
    await this.session.send('WebAuthn.addCredential', { authenticatorId: this.id, credential })
  }
}
