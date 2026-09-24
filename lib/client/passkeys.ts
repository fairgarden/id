import { useSyncExternalStore } from 'react'
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'

/**
 * The browser half of passkeys, through @simplewebauthn/browser, which turns
 * the server's JSON options into a `navigator.credentials` call and back.
 */

export const passkeysSupported = (): boolean =>
  typeof window !== 'undefined' && browserSupportsWebAuthn()

const unchanging = () => () => undefined

/** Whether this browser can use passkeys; false while rendering on the server. */
export const usePasskeySupport = (): boolean =>
  useSyncExternalStore(unchanging, passkeysSupported, () => false)

/** Whether the browser offers passkeys in an email field's autofill. */
export const autofillSupported = (): Promise<boolean> =>
  passkeysSupported() ? browserSupportsWebAuthnAutofill() : Promise.resolve(false)

export const authenticate = (options: Record<string, unknown>, { autofill = false } = {}) =>
  startAuthentication({
    optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
    useBrowserAutofill: autofill,
  })

export const register = (options: Record<string, unknown>) =>
  startRegistration({ optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON })

/** Stop a passkey request that is waiting, such as the one behind autofill. */
export const cancelPasskeyRequest = () => WebAuthnAbortService.cancelCeremony()

/** The person closed the prompt, or another request replaced this one. */
export const wasCancelled = (error: unknown): boolean => {
  const { name, code } = (error ?? {}) as { name?: string; code?: string }
  return name === 'NotAllowedError' || name === 'AbortError' || code === 'ERROR_CEREMONY_ABORTED'
}
