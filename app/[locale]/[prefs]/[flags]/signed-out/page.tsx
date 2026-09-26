'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@fairgarden/design/actions/button'
import { Link } from '@fairgarden/id/lib/link'
import { Panel, Stack } from '@fairgarden/id/lib/ui/Panel'

function Done() {
  const client = useSearchParams()?.get('client')
  return (
    <Panel
      title="You are signed out"
      lede={client ? `You signed out of ${client} and this account on this device.` : 'You signed out on this device.'}
    >
      <Stack row>
        <Button render={<Link href="/account" />} nativeButton={false}>
          Sign In Again
        </Button>
      </Stack>
    </Panel>
  )
}

export default function SignedOut() {
  return (
    <Suspense>
      <Done />
    </Suspense>
  )
}
