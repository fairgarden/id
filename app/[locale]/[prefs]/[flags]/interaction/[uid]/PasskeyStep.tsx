'use client'

import { useState } from 'react'
import { Alert } from '@fairgarden/design/feedback/alert'
import { Button } from '@fairgarden/design/actions/button'
import type { Interaction, Passkey, PasskeyChallenge } from '@fairgarden-private/id/lib/api/schemas'
import { call, messageOf } from '@fairgarden-private/id/lib/client/api'
import { register, wasCancelled } from '@fairgarden-private/id/lib/client/passkeys'
import { Panel, Stack } from '@fairgarden-private/id/lib/ui/Panel'

/** Offered after signing in by email, until there is a passkey. */
export function PasskeyStep({
  interaction,
  path,
  onDone,
  onSkip,
}: {
  interaction: Interaction
  path: (sub?: string) => string
  onDone: () => Promise<void>
  onSkip: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const add = async () => {
    setError(undefined)
    setBusy(true)
    try {
      const challenge = await call<PasskeyChallenge>(path('passkeychallenge'), {
        method: 'POST',
        body: { spec: { purpose: 'Register' } },
      })
      const credential = await register(challenge.status.options)
      await call<Passkey>(path('passkeys'), { method: 'POST', body: { spec: { credential } } })
      await onDone()
    } catch (failure) {
      if (!wasCancelled(failure)) setError(messageOf(failure))
      setBusy(false)
    }
  }

  return (
    <Panel
      eyebrow={interaction.spec.issuer.name}
      title="Sign in faster next time"
      lede="Add a passkey to sign in with your fingerprint, face or screen lock instead of waiting for an email."
    >
      {error ? (
        <Alert status="danger" title="Couldn't add it.">
          {error}
        </Alert>
      ) : null}
      <Stack row>
        <Button variant="solid" size="lg" onClick={add} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Adding…' : 'Add a Passkey'}
        </Button>
        <Button variant="text" size="lg" onClick={onSkip} disabled={busy}>
          Not Now
        </Button>
      </Stack>
    </Panel>
  )
}
