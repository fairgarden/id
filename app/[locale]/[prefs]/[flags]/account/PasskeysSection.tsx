'use client'

import { useState } from 'react'
import { Alert } from '@fairgarden/design/feedback/alert'
import { Button } from '@fairgarden/design/actions/button'
import { Field, FieldLabel } from '@fairgarden/design/forms/field'
import { Form } from '@fairgarden/design/forms/form'
import { Input } from '@fairgarden/design/forms/input'
import { Tag } from '@fairgarden/design/feedback/tag'
import type { Passkey, PasskeyChallenge } from '@fairgarden-private/id/lib/api/schemas'
import { call, messageOf } from '@fairgarden-private/id/lib/client/api'
import { register, usePasskeySupport, wasCancelled } from '@fairgarden-private/id/lib/client/passkeys'
import { Note, Stack } from '@fairgarden-private/id/lib/ui/Panel'
import styles from './account.module.css'

const date = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : undefined

function PasskeyRow({ passkey, onChanged }: { passkey: Passkey; onChanged: () => Promise<void> }) {
  const [renaming, setRenaming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(undefined)
    try {
      await action()
      await onChanged()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      // A renamed passkey keeps its row, so it has to be usable again.
      setBusy(false)
    }
  }

  const rename = (values: Record<string, unknown>) =>
    act(async () => {
      await call<Passkey>(`passkeys/${encodeURIComponent(passkey.metadata.name)}`, {
        method: 'PATCH',
        merge: true,
        body: { spec: { displayName: String(values.displayName ?? '').trim() } },
      })
      setRenaming(false)
    })

  const remove = () =>
    act(() => call(`passkeys/${encodeURIComponent(passkey.metadata.name)}`, { method: 'DELETE' }))

  return (
    <li className={styles.row}>
      {renaming ? (
        <Form onFormSubmit={rename} busy={busy}>
          <Field name="displayName">
            <FieldLabel>Passkey Name</FieldLabel>
            <Input defaultValue={passkey.spec.displayName} autoFocus required />
          </Field>
          <Stack row>
            <Button type="submit" variant="solid" size="sm" disabled={busy}>
              Save Name
            </Button>
            <Button variant="text" size="sm" onClick={() => setRenaming(false)} disabled={busy}>
              Cancel
            </Button>
          </Stack>
        </Form>
      ) : (
        <div className={styles.rowBody}>
          <strong>{passkey.spec.displayName}</strong>
          <span className={styles.muted}>
            Added {date(passkey.metadata.creationTimestamp)}
            {passkey.status.lastUsedTimestamp ? `, last used ${date(passkey.status.lastUsedTimestamp)}` : ', not used yet'}
          </span>
          <span>
            <Tag>{passkey.status.backedUp ? 'Synced' : 'This Device Only'}</Tag>
          </span>
        </div>
      )}
      {renaming ? null : (
        <Stack row>
          <Button variant="text" size="sm" onClick={() => setRenaming(true)} disabled={busy}>
            Rename
          </Button>
          <Button variant="text" size="sm" destructive onClick={remove} disabled={busy}>
            Remove
          </Button>
        </Stack>
      )}
      {error ? <Alert status="danger">{error}</Alert> : null}
    </li>
  )
}

export function PasskeysSection({
  passkeys,
  onChanged,
}: {
  passkeys: Passkey[]
  onChanged: () => Promise<void>
}) {
  const supported = usePasskeySupport()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const add = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const challenge = await call<PasskeyChallenge>('passkeychallenges', {
        method: 'POST',
        body: { spec: { purpose: 'Register' } },
      })
      const credential = await register(challenge.status.options)
      await call<Passkey>('passkeys', { method: 'POST', body: { spec: { credential } } })
      await onChanged()
    } catch (failure) {
      if (!wasCancelled(failure)) setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {passkeys.length > 0 ? (
        <ul className={styles.list}>
          {passkeys.map((passkey) => (
            <PasskeyRow key={passkey.metadata.name} passkey={passkey} onChanged={onChanged} />
          ))}
        </ul>
      ) : (
        <Note>No passkeys yet. Without one, you sign in with a code sent to your email.</Note>
      )}
      {error ? (
        <Alert status="danger" title="Couldn't add it.">
          {error}
        </Alert>
      ) : null}
      {supported ? (
        <Stack row>
          <Button onClick={add} disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Adding…' : 'Add a Passkey'}
          </Button>
        </Stack>
      ) : (
        <Note>This browser cannot make passkeys.</Note>
      )}
    </>
  )
}
