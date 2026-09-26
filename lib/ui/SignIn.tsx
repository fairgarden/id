'use client'

import { useEffect, useState } from 'react'
import { Alert } from '@fairgarden/design/feedback/alert'
import { Button } from '@fairgarden/design/actions/button'
import type { Session } from '@fairgarden/id/lib/api/schemas'
import { call, messageOf } from '@fairgarden/id/lib/client/api'
import { useHref } from '@fairgarden/id/lib/link'
import { Note, Panel, Stack } from '@fairgarden/id/lib/ui/Panel'

/**
 * Send someone to sign in to their account here, or to the account page if
 * they already are. Signing in is an OIDC interaction like any service's,
 * so there is only one way to do it.
 */
export function SignIn({ session: given }: { session?: Session }) {
  const toHref = useHref()
  const [session, setSession] = useState<Session | undefined>(given)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (given) return
    call<Session>('sessions/current')
      .then((current) => {
        if (current.status.authenticated) window.location.replace(toHref('/account'))
        else setSession(current)
      })
      .catch((failure: unknown) => setError(messageOf(failure)))
  }, [given, toHref])

  if (error) {
    return (
      <Panel title="Sign in">
        <Alert status="danger" title="Couldn't load.">
          {error}
        </Alert>
      </Panel>
    )
  }

  return (
    <Panel
      eyebrow={session?.status.issuer.name}
      title="Sign in to your account"
      lede="See what you share with each service, and manage your passkeys and details."
    >
      <Stack row>
        <Button
          variant="solid"
          size="lg"
          disabled={!session}
          render={<a href={session?.status.signInUrl} />}
          nativeButton={false}
        >
          Sign In
        </Button>
      </Stack>
      <Note>With a passkey, or a code sent to your email.</Note>
    </Panel>
  )
}
