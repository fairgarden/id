'use client'

import { useState } from 'react'
import { Alert } from '@fairgarden/design/feedback/alert'
import { Button } from '@fairgarden/design/actions/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@fairgarden/design/forms/field'
import { Form, FormActions } from '@fairgarden/design/forms/form'
import { Input } from '@fairgarden/design/forms/input'
import type { Account, Interaction } from '@fairgarden/id/lib/api/schemas'
import { call, messageOf } from '@fairgarden/id/lib/client/api'
import { Note, Panel } from '@fairgarden/id/lib/ui/Panel'

/** A new account's name: the one thing asked of everyone. */
export function ProfileStep({
  interaction,
  path,
  onSaved,
}: {
  interaction: Interaction
  path: (sub?: string) => string
  onSaved: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = async (values: Record<string, unknown>) => {
    setError(undefined)
    setErrors({})
    const displayName = String(values.displayName ?? '').trim()
    if (!displayName) return setErrors({ displayName: 'Enter the name you go by.' })
    setBusy(true)
    try {
      await call<Account>(path('account'), {
        method: 'PATCH',
        merge: true,
        body: { spec: { displayName } },
      })
      await onSaved()
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }

  return (
    <Panel
      eyebrow={interaction.spec.issuer.name}
      title="Welcome"
      lede="What should we call you?"
    >
      {error ? (
        <Alert status="danger" title="Couldn't save.">
          {error}
        </Alert>
      ) : null}
      <Form errors={errors} onFormSubmit={submit} busy={busy}>
        <Field name="displayName">
          <FieldLabel>Your Name</FieldLabel>
          <Input autoComplete="name" autoFocus required />
          <FieldDescription>Services you choose to share your name with will see it.</FieldDescription>
          <FieldError />
        </Field>
        <FormActions>
          <Button type="submit" variant="solid" size="lg" disabled={busy}>
            {busy ? 'Saving…' : 'Continue'}
          </Button>
        </FormActions>
      </Form>
      <Note>Your phone number and addresses can be added from your account, and are only shared when you say so.</Note>
    </Panel>
  )
}
