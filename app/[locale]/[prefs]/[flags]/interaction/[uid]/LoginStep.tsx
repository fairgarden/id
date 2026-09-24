'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Alert } from '@fairgarden/design/feedback/alert'
import { Button } from '@fairgarden/design/actions/button'
import { Field, FieldError, FieldLabel } from '@fairgarden/design/forms/field'
import { Form, FormActions } from '@fairgarden/design/forms/form'
import { Input } from '@fairgarden/design/forms/input'
import type { EmailChallenge, Interaction, PasskeyChallenge } from '@fairgarden-private/id/lib/api/schemas'
import { ApiFailure, call, messageOf } from '@fairgarden-private/id/lib/client/api'
import {
  authenticate,
  autofillSupported,
  cancelPasskeyRequest,
  wasCancelled,
} from '@fairgarden-private/id/lib/client/passkeys'
import { Note, Panel } from '@fairgarden-private/id/lib/ui/Panel'

/**
 * Who is signing in: a passkey, offered in the email field's autofill and by
 * a button, or an email address to send a code to.
 */
export function LoginStep({
  interaction,
  path,
  canUsePasskeys,
  onSignedIn,
  onSent,
  notice,
}: {
  interaction: Interaction
  path: (sub?: string) => string
  canUsePasskeys: boolean
  onSignedIn: (interaction: Interaction) => void
  onSent: (challenge: EmailChallenge) => Promise<void>
  notice?: ReactNode
}) {
  const [busy, setBusy] = useState<'passkey' | 'email'>()
  const [error, setError] = useState<string>()
  const [errors, setErrors] = useState<Record<string, string>>({})

  const signInWithPasskey = async (autofill: boolean) => {
    const challenge = await call<PasskeyChallenge>(path('passkeychallenge'), {
      method: 'POST',
      body: { spec: { purpose: 'Authenticate' } },
    })
    const credential = await authenticate(challenge.status.options, { autofill })
    setBusy('passkey')
    onSignedIn(
      await call<Interaction>(path('login'), {
        method: 'POST',
        body: { spec: { method: 'Passkey', credential } },
      })
    )
  }

  // Offer passkeys in the email field's autofill, where the browser can.
  useEffect(() => {
    let active = true
    autofillSupported().then((supported) => {
      if (!supported || !active) return
      signInWithPasskey(true).catch((failure: unknown) => {
        if (active && !wasCancelled(failure)) setError(messageOf(failure))
        setBusy(undefined)
      })
    })
    return () => {
      active = false
      cancelPasskeyRequest()
    }
    // Once per sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const usePasskey = async () => {
    setError(undefined)
    setBusy('passkey')
    try {
      await signInWithPasskey(false)
    } catch (failure) {
      if (!wasCancelled(failure)) setError(messageOf(failure))
      setBusy(undefined)
    }
  }

  const sendEmail = async (values: Record<string, unknown>) => {
    setError(undefined)
    setErrors({})
    const email = String(values.email ?? '').trim()
    if (!email) return setErrors({ email: 'Enter your email address.' })
    setBusy('email')
    try {
      await onSent(
        await call<EmailChallenge>(path('emailchallenge'), {
          method: 'POST',
          body: { spec: { email } },
        })
      )
    } catch (failure) {
      const field = failure instanceof ApiFailure ? failure.field('spec.email') : undefined
      if (field) setErrors({ email: field })
      else setError(messageOf(failure))
      setBusy(undefined)
    }
  }

  const { client, issuer, loginHint } = interaction.spec

  return (
    <Panel
      eyebrow={issuer.name}
      title={`Sign in to ${client.name}`}
      lede={`Use your ${issuer.name} account. New here? Enter your email and we will set one up.`}
    >
      {notice}
      {error ? (
        <Alert status="danger" title="Couldn't sign in.">
          {error}
        </Alert>
      ) : null}
      {canUsePasskeys ? (
        <Button
          variant="solid"
          size="lg"
          onClick={usePasskey}
          disabled={busy !== undefined}
          aria-busy={busy === 'passkey' || undefined}
        >
          {busy === 'passkey' ? 'Checking…' : 'Sign In With a Passkey'}
        </Button>
      ) : null}
      <Form errors={errors} onFormSubmit={sendEmail} busy={busy === 'email'}>
        <Field name="email">
          <FieldLabel>Email Address</FieldLabel>
          <Input
            type="email"
            autoComplete="username webauthn"
            defaultValue={loginHint ?? ''}
            placeholder="name@example.com"
            required
          />
          <FieldError />
        </Field>
        <FormActions>
          <Button
            type="submit"
            size="lg"
            variant={canUsePasskeys ? 'outline' : 'solid'}
            disabled={busy !== undefined}
            aria-busy={busy === 'email' || undefined}
          >
            {busy === 'email' ? 'Sending…' : 'Email Me a Code'}
          </Button>
        </FormActions>
      </Form>
      <Note>{client.name} will ask before it sees anything about you.</Note>
    </Panel>
  )
}
