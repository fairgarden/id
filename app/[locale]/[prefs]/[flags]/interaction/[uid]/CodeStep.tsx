'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Alert } from '@fairgarden/design/feedback/alert'
import { Button } from '@fairgarden/design/actions/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@fairgarden/design/forms/field'
import { Form, FormActions } from '@fairgarden/design/forms/form'
import { Input } from '@fairgarden/design/forms/input'
import type { EmailChallenge, Interaction } from '@fairgarden/id/lib/api/schemas'
import { ApiFailure, call, messageOf } from '@fairgarden/id/lib/client/api'
import { Note, Panel, Stack } from '@fairgarden/id/lib/ui/Panel'

/** The email went out: type its code here, or open its link in this browser. */
export function CodeStep({
  interaction,
  path,
  sent,
  onSent,
  onSignedIn,
  onChangeEmail,
  notice,
}: {
  interaction: Interaction
  path: (sub?: string) => string
  sent?: EmailChallenge
  onSent: (challenge: EmailChallenge) => void
  onSignedIn: (interaction: Interaction) => void
  onChangeEmail: () => void
  notice?: ReactNode
}) {
  const challenge = interaction.status.emailChallenge!
  const [busy, setBusy] = useState<'code' | 'resend'>()
  const [error, setError] = useState<string>()
  const [info, setInfo] = useState<string>()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [now, setNow] = useState(() => Date.now())

  const resendAt = sent ? new Date(sent.status.resendAfterTimestamp).getTime() : 0
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000))
  useEffect(() => {
    if (wait === 0) return
    const timer = window.setTimeout(() => setNow(Date.now()), 1000)
    return () => window.clearTimeout(timer)
  }, [wait, now])

  const submit = async (values: Record<string, unknown>) => {
    setError(undefined)
    setErrors({})
    const code = String(values.code ?? '').replace(/\D/g, '')
    if (code.length !== 6) return setErrors({ code: 'Enter the six digits from the email.' })
    setBusy('code')
    try {
      onSignedIn(
        await call<Interaction>(path('login'), {
          method: 'POST',
          body: { spec: { method: 'EmailCode', code } },
        })
      )
    } catch (failure) {
      const field = failure instanceof ApiFailure ? failure.field('spec.code') : undefined
      if (field) setErrors({ code: messageOf(failure) })
      else setError(messageOf(failure))
      setBusy(undefined)
    }
  }

  const resend = async () => {
    setError(undefined)
    setInfo(undefined)
    setBusy('resend')
    try {
      onSent(
        await call<EmailChallenge>(path('emailchallenge'), {
          method: 'POST',
          body: { spec: { email: challenge.email } },
        })
      )
      setNow(Date.now())
      setInfo('Sent. The code in the new email replaces the old one.')
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <Panel
      eyebrow={interaction.spec.issuer.name}
      title="Check your email"
      lede={`We sent a code to ${challenge.email}. Type it here, or open the link in the email in this browser.`}
    >
      {notice}
      {error ? (
        <Alert status="danger" title="Couldn't sign in.">
          {error}
        </Alert>
      ) : null}
      {info ? <Alert status="success">{info}</Alert> : null}
      {challenge.mockMailbox ? (
        <Alert status="info" title="Local development.">
          Email is not sent from here; read it in the{' '}
          <a href={challenge.mockMailbox} target="_blank" rel="noreferrer">
            mock mailbox
          </a>
          .
        </Alert>
      ) : null}
      <Form errors={errors} onFormSubmit={submit} busy={busy === 'code'}>
        <Field name="code">
          <FieldLabel>Code</FieldLabel>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            style={{ width: '10ch' }}
            autoFocus
            required
          />
          <FieldDescription>Six digits. It works for 15 minutes.</FieldDescription>
          <FieldError />
        </Field>
        <FormActions>
          <Button type="submit" variant="solid" size="lg" disabled={busy !== undefined}>
            {busy === 'code' ? 'Checking…' : 'Continue'}
          </Button>
        </FormActions>
      </Form>
      <Stack row>
        <Button variant="text" onClick={resend} disabled={busy !== undefined || wait > 0}>
          {wait > 0 ? `Send Again in ${wait}s` : 'Send Again'}
        </Button>
        <Button variant="text" onClick={onChangeEmail} disabled={busy !== undefined}>
          Use a Different Email
        </Button>
      </Stack>
      <Note>Did not get it? Check your spam folder, or send it again.</Note>
    </Panel>
  )
}
