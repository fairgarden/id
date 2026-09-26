'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Alert } from '@fairgarden/design/feedback/alert'
import type { EmailChallenge, Interaction } from '@fairgarden/id/lib/api/schemas'
import { ApiFailure, call, messageOf } from '@fairgarden/id/lib/client/api'
import { usePasskeySupport } from '@fairgarden/id/lib/client/passkeys'
import { Panel } from '@fairgarden/id/lib/ui/Panel'
import { CodeStep } from './CodeStep'
import { ConsentStep } from './ConsentStep'
import { LoginStep } from './LoginStep'
import { PasskeyStep } from './PasskeyStep'
import { ProfileStep } from './ProfileStep'

/**
 * A sign-in, from the service asking to the service getting its answer.
 *
 * Everything here is the `Interaction` resource and its subresources: the
 * page shows whichever step its phase calls for, and follows
 * `status.returnTo` back to oidc-provider once there is nothing left to ask.
 */
function InteractionFlow() {
  const uid = useParams<{ uid: string }>()?.uid ?? ''
  const search = useSearchParams()
  const [interaction, setInteraction] = useState<Interaction>()
  const [failure, setFailure] = useState<unknown>()
  const [notice, setNotice] = useState<string>()
  const [sent, setSent] = useState<EmailChallenge>()
  const [changingEmail, setChangingEmail] = useState(false)
  const [skippedPasskey, setSkippedPasskey] = useState(false)
  const canUsePasskeys = usePasskeySupport()

  const path = useCallback((sub?: string) => `interactions/${uid}${sub ? `/${sub}` : ''}`, [uid])

  useEffect(() => {
    const token = search?.get('token')
    ;(async () => {
      if (token) {
        // Out of the address bar and history before anything else happens.
        window.history.replaceState(null, '', window.location.pathname)
        try {
          const signedIn = await call<Interaction>(path('login'), {
            method: 'POST',
            body: { spec: { method: 'EmailLink', token } },
          })
          setInteraction(signedIn)
          return
        } catch (error) {
          if (error instanceof ApiFailure && error.code === 403) return setFailure(error)
          setNotice(messageOf(error))
        }
      }
      try {
        setInteraction(await call<Interaction>(path()))
      } catch (error) {
        setFailure(error)
      }
    })()
    // Once, for the sign-in in the address bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  const phase = interaction?.status.phase
  const account = interaction?.status.account
  const leaving =
    phase === 'Completed' ||
    phase === 'Aborted' ||
    (phase === 'Authenticated' &&
      Boolean(account?.displayName) &&
      (Boolean(account?.passkeys) || skippedPasskey || !canUsePasskeys))

  useEffect(() => {
    if (leaving && interaction?.status.returnTo) window.location.assign(interaction.status.returnTo)
  }, [leaving, interaction])

  if (failure) return <Failed failure={failure} />
  if (!interaction) return <Panel title="Signing in…" />

  const client = interaction.spec.client.name
  const issuer = interaction.spec.issuer.name
  const update = (next: Interaction) => {
    setNotice(undefined)
    setInteraction(next)
  }
  const reload = async () => update(await call<Interaction>(path()))

  if (leaving) {
    return (
      <Panel
        eyebrow={issuer}
        title={phase === 'Aborted' ? 'Cancelled' : 'Signed in'}
        lede={`Taking you back to ${client}…`}
      />
    )
  }

  const alert = notice ? (
    <Alert status="warning" title="That link didn't work.">
      {notice}
    </Alert>
  ) : null

  switch (phase) {
    case 'LoginRequired': {
      const challenge = interaction.status.emailChallenge
      if (challenge && !changingEmail) {
        return (
          <CodeStep
            interaction={interaction}
            path={path}
            sent={sent}
            onSent={setSent}
            onSignedIn={update}
            onChangeEmail={() => setChangingEmail(true)}
            notice={alert}
          />
        )
      }
      return (
        <LoginStep
          interaction={interaction}
          path={path}
          canUsePasskeys={canUsePasskeys}
          onSignedIn={update}
          onSent={async (challenge) => {
            setSent(challenge)
            setChangingEmail(false)
            await reload()
          }}
          notice={alert}
        />
      )
    }
    case 'Authenticated':
      if (!account?.displayName) {
        return <ProfileStep interaction={interaction} path={path} onSaved={reload} />
      }
      return (
        <PasskeyStep
          interaction={interaction}
          path={path}
          onDone={reload}
          onSkip={() => setSkippedPasskey(true)}
        />
      )
    case 'ConsentRequired':
      return <ConsentStep interaction={interaction} path={path} onDecided={update} />
    default:
      return <Panel title="Signing in…" />
  }
}

function Failed({ failure }: { failure: unknown }) {
  const code = failure instanceof ApiFailure ? failure.code : 0
  if (code === 403) {
    return (
      <Panel
        title="Continue in your other browser"
        lede="This sign-in was started in a different browser. Open the link from your email there, or type the code from the email into it."
      />
    )
  }
  if (code === 404 || code === 410) {
    return (
      <Panel
        title="This sign-in has ended"
        lede="It expired, or was already finished. Go back to where you were signing in and start again."
      />
    )
  }
  return (
    <Panel title="Something went wrong">
      <Alert status="danger" title="Couldn't load.">
        {messageOf(failure)}
      </Alert>
    </Panel>
  )
}

export default function InteractionPage() {
  return (
    <Suspense>
      <InteractionFlow />
    </Suspense>
  )
}
