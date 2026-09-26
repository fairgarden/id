'use client'

import { useState } from 'react'
import { Alert } from '@fairgarden/design/feedback/alert'
import { Button } from '@fairgarden/design/actions/button'
import { Checkbox } from '@fairgarden/design/forms/checkbox'
import { Tag } from '@fairgarden/design/feedback/tag'
import type { Interaction, ScopeRequest } from '@fairgarden/id/lib/api/schemas'
import { call, messageOf } from '@fairgarden/id/lib/client/api'
import { Link } from '@fairgarden/id/lib/link'
import { Note, Panel, Stack } from '@fairgarden/id/lib/ui/Panel'
import styles from './consent.module.css'

/**
 * What a service may see. Nothing sensitive, and nothing kept by another
 * service, is ticked for the person: they choose it, or it is not shared.
 */
export function ConsentStep({
  interaction,
  path,
  onDecided,
}: {
  interaction: Interaction
  path: (sub?: string) => string
  onDecided: (interaction: Interaction) => void
}) {
  const scopes = interaction.status.consent?.scopes ?? []
  const [chosen, setChosen] = useState<Set<string>>(
    () =>
      new Set(
        scopes
          // As they answered last time; otherwise nothing sensitive.
          .filter(
            (scope) =>
              scope.required ||
              scope.previously === 'granted' ||
              (scope.previously === null && scope.available && !scope.sensitive)
          )
          .map((scope) => scope.name)
      )
  )
  const [busy, setBusy] = useState<'allow' | 'cancel'>()
  const [error, setError] = useState<string>()

  const toggle = (name: string, checked: boolean) =>
    setChosen((current) => {
      const next = new Set(current)
      if (checked) next.add(name)
      else next.delete(name)
      return next
    })

  const decide = async (allow: boolean) => {
    setError(undefined)
    setBusy(allow ? 'allow' : 'cancel')
    try {
      onDecided(
        allow
          ? await call<Interaction>(path('consent'), {
              method: 'POST',
              body: { spec: { scopes: [...chosen] } },
            })
          : await call<Interaction>(path(), { method: 'DELETE' })
      )
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(undefined)
    }
  }

  const { client, issuer } = interaction.spec
  const account = interaction.status.account

  return (
    <Panel
      eyebrow={issuer.name}
      title={`Share with ${client.name}?`}
      lede={`Choose what ${client.name} can see. You can change this later in your account.`}
    >
      {error ? (
        <Alert status="danger" title="Couldn't save that.">
          {error}
        </Alert>
      ) : null}
      <div className={styles.list}>
        {scopes.map((scope) => (
          <Checkbox
            key={scope.name}
            checked={chosen.has(scope.name)}
            disabled={scope.required || !scope.available || busy !== undefined}
            onCheckedChange={(checked) => toggle(scope.name, checked === true)}
            description={<ScopeDetails scope={scope} client={client.name} />}
          >
            {scope.title}
          </Checkbox>
        ))}
      </div>
      <Stack row>
        <Button
          variant="solid"
          size="lg"
          onClick={() => decide(true)}
          disabled={busy !== undefined}
          aria-busy={busy === 'allow' || undefined}
        >
          {busy === 'allow' ? 'Saving…' : 'Allow'}
        </Button>
        <Button size="lg" onClick={() => decide(false)} disabled={busy !== undefined}>
          Cancel
        </Button>
      </Stack>
      <Note>
        What {client.name} may be offered is set by <Link href="/policy">the policy</Link>.
        {account ? ` Signed in as ${account.email}.` : null}
      </Note>
    </Panel>
  )
}

function ScopeDetails({ scope, client }: { scope: ScopeRequest; client: string }) {
  return (
    <span className={styles.details}>
      <span>{scope.description}</span>
      {scope.preview && scope.preview.length > 0 ? (
        <span className={styles.preview}>
          {scope.preview.map((line, index) => (
            <span key={index}>{line}</span>
          ))}
        </span>
      ) : scope.preview ? (
        <span className={styles.missing}>Nothing added yet.</span>
      ) : null}
      {!scope.available && scope.reason ? <span className={styles.missing}>{scope.reason}</span> : null}
      <span className={styles.tags}>
        {scope.required ? <Tag>Always Shared</Tag> : null}
        {scope.sensitive ? <Tag>Sensitive</Tag> : null}
        {scope.source ? <Tag>From {scope.source}</Tag> : null}
        {!scope.available ? <Tag>Not Available to {client}</Tag> : null}
      </span>
    </span>
  )
}
