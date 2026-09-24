'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@fairgarden/design/actions/button'
import { MOUNT } from '@fairgarden-private/id/lib/client/api'
import { Panel, Stack } from '@fairgarden-private/id/lib/ui/Panel'

// oidc-provider asks here before ending a session: a service can send someone
// to sign out, but only they can confirm it. The form posts the token it was
// given back to oidc-provider.
function Confirm() {
  const params = useSearchParams()
  const xsrf = params?.get('xsrf') ?? ''
  const client = params?.get('client')

  return (
    <Panel
      title="Sign out?"
      lede={
        client
          ? `${client} asked to sign you out. You will be signed out on this device.`
          : 'You will be signed out on this device.'
      }
    >
      <form method="post" action={`${MOUNT}/oidc/session/end/confirm`}>
        <input type="hidden" name="xsrf" value={xsrf} />
        <Stack row>
          <Button type="submit" variant="solid" size="lg" name="logout" value="yes" autoFocus>
            Sign Out
          </Button>
          <Button type="submit" size="lg">
            Stay Signed In
          </Button>
        </Stack>
      </form>
    </Panel>
  )
}

export default function SignOut() {
  return (
    <Suspense>
      <Confirm />
    </Suspense>
  )
}
