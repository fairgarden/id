'use client'

import { useState } from 'react'
import { Alert } from '@fairgarden/design/feedback/alert'
import { Button } from '@fairgarden/design/actions/button'
import { Checkbox } from '@fairgarden/design/forms/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@fairgarden/design/forms/field'
import { Fieldset, FieldsetLegend } from '@fairgarden/design/forms/fieldset'
import { Form, FormActions, FormRow } from '@fairgarden/design/forms/form'
import { Input } from '@fairgarden/design/forms/input'
import type { Account, Address } from '@fairgarden-private/id/lib/api/schemas'
import { ApiFailure, call, messageOf } from '@fairgarden-private/id/lib/client/api'

const ADDRESS_PARTS = ['streetAddress', 'locality', 'region', 'postalCode', 'country'] as const

const sameAddress = (a: Address | null, b: Address | null) =>
  ADDRESS_PARTS.every((part) => (a?.[part] ?? '') === (b?.[part] ?? ''))

/** Read an address's parts back out of the form, or null when it is empty. */
const addressFrom = (values: Record<string, unknown>, prefix: string): Address | null => {
  const address: Address = {}
  for (const part of ADDRESS_PARTS) {
    const value = String(values[`${prefix}.${part}`] ?? '').trim()
    if (value) address[part] = value
  }
  return Object.keys(address).length > 0 ? address : null
}

/** Every part, so a merge patch clears the parts left empty. */
const addressPatch = (address: Address | null) =>
  address ? Object.fromEntries(ADDRESS_PARTS.map((part) => [part, address[part] ?? null])) : null

/** `spec.mailingAddress.locality` -> `mailing.locality`, the form's names. */
const formField = (field: string) =>
  field
    .replace(/^spec\./, '')
    .replace(/^mailingAddress/, 'mailing')
    .replace(/^residentialAddress/, 'residential')

function AddressFields({ prefix, address }: { prefix: string; address: Address | null }) {
  return (
    <>
      <Field name={`${prefix}.streetAddress`}>
        <FieldLabel optional>Street Address</FieldLabel>
        <Input multiline rows={3} defaultValue={address?.streetAddress ?? ''} autoComplete={`${prefix === 'mailing' ? 'shipping' : 'home'} street-address`} />
        <FieldError />
      </Field>
      <FormRow>
        <Field name={`${prefix}.locality`}>
          <FieldLabel optional>City or Town</FieldLabel>
          <Input defaultValue={address?.locality ?? ''} autoComplete="address-level2" />
          <FieldError />
        </Field>
        <Field name={`${prefix}.region`}>
          <FieldLabel optional>State or Region</FieldLabel>
          <Input defaultValue={address?.region ?? ''} autoComplete="address-level1" />
          <FieldError />
        </Field>
      </FormRow>
      <FormRow>
        <Field name={`${prefix}.postalCode`}>
          <FieldLabel optional>Postal Code</FieldLabel>
          <Input defaultValue={address?.postalCode ?? ''} autoComplete="postal-code" style={{ width: '12ch' }} />
          <FieldError />
        </Field>
        <Field name={`${prefix}.country`}>
          <FieldLabel optional>Country</FieldLabel>
          <Input defaultValue={address?.country ?? ''} autoComplete="country-name" />
          <FieldError />
        </Field>
      </FormRow>
    </>
  )
}

/**
 * Name, phone number and addresses. Only a service the person agreed to
 * share them with ever sees them.
 */
export function ProfileSection({
  account,
  onSaved,
}: {
  account: Account
  onSaved: (account: Account) => void
}) {
  const { spec } = account
  const [sameAsMailing, setSameAsMailing] = useState(
    Boolean(spec.residentialAddress) && sameAddress(spec.mailingAddress, spec.residentialAddress)
  )
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)

  const submit = async (values: Record<string, unknown>) => {
    setBusy(true)
    setError(undefined)
    setErrors({})
    setSaved(false)
    const mailingAddress = addressFrom(values, 'mailing')
    const residentialAddress = sameAsMailing ? mailingAddress : addressFrom(values, 'residential')
    try {
      const updated = await call<Account>('accounts/me', {
        method: 'PATCH',
        merge: true,
        body: {
          // Refused if the account changed in another tab since this loaded.
          metadata: { resourceVersion: account.metadata.resourceVersion },
          spec: {
            displayName: String(values.displayName ?? '').trim() || null,
            phoneNumber: String(values.phoneNumber ?? '').trim() || null,
            mailingAddress: addressPatch(mailingAddress),
            residentialAddress: addressPatch(residentialAddress),
          },
        },
      })
      onSaved(updated)
      setSaved(true)
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status.details?.causes?.length) {
        setErrors(
          Object.fromEntries(
            failure.status.details.causes.map((cause) => [
              formField(cause.field ?? ''),
              cause.message ?? 'Check this.',
            ])
          )
        )
      }
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Form errors={errors} onFormSubmit={submit} busy={busy}>
      {error ? (
        <Alert status="danger" title="Couldn't save.">
          {error}
        </Alert>
      ) : null}
      {saved ? <Alert status="success">Saved.</Alert> : null}
      <Field name="displayName">
        <FieldLabel>Name</FieldLabel>
        <Input defaultValue={spec.displayName ?? ''} autoComplete="name" />
        <FieldError />
      </Field>
      <Field name="phoneNumber">
        <FieldLabel optional>Phone Number</FieldLabel>
        <Input type="tel" defaultValue={spec.phoneNumber ?? ''} autoComplete="tel" />
        <FieldDescription>With the country code, like +1 555 010 0000.</FieldDescription>
        <FieldError />
      </Field>
      <Fieldset>
        <FieldsetLegend>Mailing Address</FieldsetLegend>
        <AddressFields prefix="mailing" address={spec.mailingAddress} />
      </Fieldset>
      <Fieldset>
        <FieldsetLegend>Residential Address</FieldsetLegend>
        <Checkbox checked={sameAsMailing} onCheckedChange={(checked) => setSameAsMailing(checked === true)}>
          Same as My Mailing Address
        </Checkbox>
        {sameAsMailing ? null : <AddressFields prefix="residential" address={spec.residentialAddress} />}
      </Fieldset>
      <FormActions>
        <Button type="submit" variant="solid" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Saving…' : 'Save Details'}
        </Button>
      </FormActions>
    </Form>
  )
}
