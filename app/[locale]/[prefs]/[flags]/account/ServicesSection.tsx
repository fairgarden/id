'use client'

import { useState } from 'react'
import { Alert } from '@fairgarden/design/feedback/alert'
import { Button } from '@fairgarden/design/actions/button'
import { Tag } from '@fairgarden/design/feedback/tag'
import type { Grant } from '@fairgarden-private/id/lib/api/schemas'
import { call, messageOf } from '@fairgarden-private/id/lib/client/api'
import { Note, Stack } from '@fairgarden-private/id/lib/ui/Panel'
import styles from './account.module.css'

function GrantRow({ grant, onChanged }: { grant: Grant; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const { client, shared } = grant.status

  const remove = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await call(`grants/${encodeURIComponent(grant.metadata.name)}`, { method: 'DELETE' })
      await onChanged()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={styles.row}>
      <div className={styles.rowBody}>
        <strong>{client.uri ? <a href={client.uri}>{client.name}</a> : client.name}</strong>
        <span className={styles.tags}>
          {shared.map((scope) => (
            <Tag key={scope.name}>{scope.title}</Tag>
          ))}
        </span>
        {grant.spec.rejectedScopes.length > 0 ? (
          <span className={styles.muted}>
            You declined to share {grant.spec.rejectedScopes.length === 1 ? 'one thing' : `${grant.spec.rejectedScopes.length} things`} it asked for.
          </span>
        ) : null}
      </div>
      <Stack row>
        <Button variant="text" size="sm" destructive onClick={remove} disabled={busy}>
          Remove Access
        </Button>
      </Stack>
      {error ? <Alert status="danger">{error}</Alert> : null}
    </li>
  )
}

/**
 * Each service this person has signed in to, and what it may see. Removing
 * access signs them out of it, and it has to ask again next time.
 */
export function ServicesSection({ grants, onChanged }: { grants: Grant[]; onChanged: () => Promise<void> }) {
  if (grants.length === 0) return <Note>You have not signed in to any services yet.</Note>
  return (
    <>
      <ul className={styles.list}>
        {grants.map((grant) => (
          <GrantRow key={grant.metadata.name} grant={grant} onChanged={onChanged} />
        ))}
      </ul>
      <Note>
        To share something you declined, remove the service’s access and sign in to it again, or share it when the
        service asks again.
      </Note>
    </>
  )
}
