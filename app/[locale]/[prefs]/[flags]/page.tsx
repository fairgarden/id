import { Button } from '@fairgarden/design/actions/button'
import { Link } from '@fairgarden-private/id/lib/link'
import { Note, Panel, Stack } from '@fairgarden-private/id/lib/ui/Panel'

const name = process.env.FG_ID_NAME ?? 'Fair Garden'

// Prerendered for every locale and theme; the name is read at build time.
export default function Home() {
  return (
    <Panel
      eyebrow={name}
      title="One account for every service"
      lede={`Sign in to ${name} services with a passkey or your email, and decide what each one can see.`}
    >
      <Stack row>
        <Button variant="solid" size="lg" render={<Link href="/account" />} nativeButton={false}>
          Manage Your Account
        </Button>
      </Stack>
      <Note>Services send you here to sign in; you do not need to start from this page.</Note>
    </Panel>
  )
}
