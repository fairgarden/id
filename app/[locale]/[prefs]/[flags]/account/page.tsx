'use client'

import { useEffect, useState } from 'react'
import { Alert } from '@fairgarden/design/feedback/alert'
import { Button } from '@fairgarden/design/actions/button'
import type {
  Account,
  GrantList,
  PasskeyList,
  PolicyDecisionList,
  Session,
} from '@fairgarden-private/id/lib/api/schemas'
import { call, messageOf } from '@fairgarden-private/id/lib/client/api'
import ThemeToggle from '@fairgarden-private/id/lib/theme'
import { Panel, Section, Stack } from '@fairgarden-private/id/lib/ui/Panel'
import { SignIn } from '@fairgarden-private/id/lib/ui/SignIn'
import { DecisionsSection } from './DecisionsSection'
import { PasskeysSection } from './PasskeysSection'
import { ProfileSection } from './ProfileSection'
import { ServicesSection } from './ServicesSection'

interface Loaded {
  session: Session
  account: Account
  passkeys: PasskeyList
  grants: GrantList
  decisions: PolicyDecisionList
}

// What was decided when each service was answered; the consent screen asks too, while it is shown.
const DECISIONS = 'policydecisions?fieldSelector=spec.decision=release,spec.input.purpose=Consent&limit=10'

/**
 * Everything a person can see and change here: their details, their
 * passkeys, and what each service they signed in to may see.
 */
export default function AccountPage() {
  const [session, setSession] = useState<Session>()
  const [loaded, setLoaded] = useState<Loaded>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const current = await call<Session>('sessions/current')
        if (!current.status.authenticated) {
          if (active) setSession(current)
          return
        }
        const [account, passkeys, grants, decisions] = await Promise.all([
          call<Account>('accounts/me'),
          call<PasskeyList>('passkeys'),
          call<GrantList>('grants'),
          call<PolicyDecisionList>(DECISIONS),
        ])
        if (!active) return
        setSession(current)
        setLoaded({ session: current, account, passkeys, grants, decisions })
      } catch (failure) {
        if (active) setError(messageOf(failure))
      }
    })()
    return () => {
      active = false
    }
  }, [])

  if (error) {
    return (
      <Panel title="Your account">
        <Alert status="danger" title="Couldn't load.">
          {error}
        </Alert>
      </Panel>
    )
  }
  if (session && !session.status.authenticated) return <SignIn session={session} />
  if (!loaded) return <Panel title="Your account" />

  const { account, passkeys, grants, decisions } = loaded
  const name = account.spec.displayName ?? account.status.email

  return (
    <Panel wide eyebrow={loaded.session.status.issuer.name} title={name} lede={account.status.email}>
      <Section title="Your details">
        <ProfileSection
          account={account}
          onSaved={(updated) => setLoaded({ ...loaded, account: updated })}
        />
      </Section>
      <Section title="Passkeys">
        <PasskeysSection
          passkeys={passkeys.items}
          onChanged={async () => setLoaded({ ...loaded, passkeys: await call<PasskeyList>('passkeys') })}
        />
      </Section>
      <Section title="Connected services">
        <ServicesSection
          grants={grants.items}
          onChanged={async () => setLoaded({ ...loaded, grants: await call<GrantList>('grants') })}
        />
      </Section>
      <Section title="What policy decided">
        <DecisionsSection decisions={decisions.items} />
      </Section>
      <Section title="Appearance">
        <ThemeToggle />
      </Section>
      {loaded.session.status.signOutUrl ? (
        <Stack row>
          <Button render={<a href={loaded.session.status.signOutUrl} />} nativeButton={false}>
            Sign Out
          </Button>
        </Stack>
      ) : null}
    </Panel>
  )
}
