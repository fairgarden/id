'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Alert } from '@fairgarden/design/feedback/alert'
import { Button } from '@fairgarden/design/actions/button'
import { Link } from '@fairgarden/id/lib/link'
import { Panel, Stack } from '@fairgarden/id/lib/ui/Panel'

// Where oidc-provider sends an error it cannot hand back to the service, such
// as an unknown client or redirect URI.
function ErrorDetails() {
  const params = useSearchParams()
  const error = params?.get('error')
  const description = params?.get('description')

  return (
    <Panel title="Something went wrong" lede="The service that sent you here asked for something we could not do.">
      {error ? (
        <Alert status="danger" title={error}>
          {description ?? 'No more detail was given.'}
        </Alert>
      ) : null}
      <Stack row>
        <Button render={<Link href="/account" />} nativeButton={false}>
          Go to Your Account
        </Button>
      </Stack>
    </Panel>
  )
}

export default function ErrorPage() {
  return (
    <Suspense>
      <ErrorDetails />
    </Suspense>
  )
}
