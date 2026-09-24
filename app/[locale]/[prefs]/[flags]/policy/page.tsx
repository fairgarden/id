'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Alert } from '@fairgarden/design/feedback/alert'
import { Tag } from '@fairgarden/design/feedback/tag'
import { SpecList, SpecListItem } from '@fairgarden/design/data/spec-list'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@fairgarden/design/disclosure/collapsible'
import type from '@fairgarden/design/utils/type.module.css'
import type { Policy } from '@fairgarden-private/id/lib/api/schemas'
import { call, messageOf } from '@fairgarden-private/id/lib/client/api'
import { Link } from '@fairgarden-private/id/lib/link'
import { Note, Panel, Section, Stack } from '@fairgarden-private/id/lib/ui/Panel'
import styles from './policy.module.css'

type Package = Policy['spec']['packages'][number]
type Related = Package['related']

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

function RelatedLinks({ related }: { related: Related }) {
  if (related.length === 0) return null
  return (
    <span className={styles.links}>
      {related.map((resource) => (
        <a key={resource.ref} href={resource.ref} rel="noreferrer">
          {resource.description ?? resource.ref}
        </a>
      ))}
    </span>
  )
}

function layerName(policy: Policy, path: string | undefined) {
  const layer = policy.spec.layers.find((candidate) => candidate.path === path)
  if (!layer) return undefined
  if (layer.role === 'organization') return 'The organization’s'
  const name = layer.package?.split('/').pop() ?? layer.path
  return `From ${name}${layer.version ? ` ${layer.version}` : ''}`
}

function PackageSection({ policy, pkg }: { policy: Policy; pkg: Package }) {
  return (
    <Section title={pkg.title ?? pkg.name}>
      {pkg.description ? <p>{pkg.description}</p> : null}
      <RelatedLinks related={pkg.related} />
      <ul className={styles.list}>
        {pkg.decisions.map((decision) => (
          <li key={decision.path} className={styles.decision}>
            <strong>{decision.title ?? decision.name}</strong>
            {decision.description ? <span>{decision.description}</span> : null}
            <RelatedLinks related={decision.related} />
            <span className={`${type.typeData} ${styles.muted}`}>{decision.path}</span>
          </li>
        ))}
      </ul>
      {pkg.sources.map((source) => (
        <Collapsible key={source.path}>
          <CollapsibleTrigger openLabel={`Hide ${source.path}`}>Read {source.path}</CollapsibleTrigger>
          <CollapsiblePanel>
            <div className={styles.source}>
              {layerName(policy, source.layer) ? (
                <span>
                  <Tag>{layerName(policy, source.layer)}</Tag>
                </span>
              ) : null}
              <pre className={`${type.typeData} ${styles.code}`}>{source.text}</pre>
            </div>
          </CollapsiblePanel>
        </Collapsible>
      ))}
    </Section>
  )
}

/**
 * The policy in force, for everyone it governs: what each decision is for,
 * in the organization's words, the rules themselves, and where they came
 * from. `?revision=` shows one that was in force, for reading a past
 * decision beside the rules that made it. Anyone may read it, signed in or
 * not.
 */
function PolicyDetails() {
  const revision = useSearchParams()?.get('revision') ?? undefined
  const asked = revision ?? 'current'
  // Each answer is kept with what it answers, so going from one revision to
  // another never shows the last one's rules, or its error, under the next.
  const [answer, setAnswer] = useState<{ for: string; policy?: Policy; error?: string }>()

  useEffect(() => {
    call<Policy>(`policies/${encodeURIComponent(asked)}`).then(
      (policy) =>
        setAnswer(
          policy?.kind === 'Policy' ? { for: asked, policy } : { for: asked, error: 'There is no such policy.' }
        ),
      (failure: unknown) => setAnswer({ for: asked, error: messageOf(failure) })
    )
  }, [asked])

  const { policy, error } = answer?.for === asked ? answer : {}

  if (error) {
    return (
      <Panel title="Policy">
        <Alert status="danger" title="Couldn't load.">
          {error}
        </Alert>
      </Panel>
    )
  }
  if (!policy) return <Panel title="Policy" wide />

  const { spec, status } = policy
  const organization = text(spec.organization.organization)
  const source = text(spec.organization.source)
  const settings = spec.settings && typeof spec.settings === 'object' && Object.keys(spec.settings).length > 0

  return (
    <Panel
      wide
      eyebrow={organization}
      title="Policy"
      lede={
        spec.engine === 'builtin'
          ? 'What decides who can see and change what here, and what each service may ask of you.'
          : `The rules ${organization ?? 'the organization'} keeps for its services: who can see and change what, and what each service may ask of you.`
      }
    >
      {status.phase === 'Refused' ? (
        <Alert status="danger" title="This policy is not in force.">
          {status.message} Until it is signed by the organization, nothing that needs a decision can be done.
        </Alert>
      ) : null}
      {status.phase === 'Unavailable' ? (
        <Alert status="danger" title="The policy could not be read.">
          Until it can, nothing that needs a decision can be done. Try again shortly.
        </Alert>
      ) : null}
      {status.phase === 'Undisclosed' ? (
        <Alert status="info" title="The rules are held elsewhere.">
          A policy server makes these decisions, and it does not say what its rules are.
        </Alert>
      ) : null}
      {revision ? (
        <Alert status="info" title={`Revision ${revision}`}>
          {policy.metadata.creationTimestamp
            ? `This service first ran it ${new Date(policy.metadata.creationTimestamp).toLocaleDateString(undefined, { dateStyle: 'long' })}. `
            : null}
          <Link href="/policy">Read the policy in force now</Link>.
        </Alert>
      ) : null}
      {spec.engine === 'builtin' ? (
        <Note>No organization has set a policy here, so the service’s own rules decide.</Note>
      ) : null}

      {spec.engine !== 'builtin' ? (
        <SpecList>
          {spec.revision ? <SpecListItem label="Revision">{spec.revision}</SpecListItem> : null}
          {spec.commit ? <SpecListItem label="Built from">commit {spec.commit.slice(0, 7)}</SpecListItem> : null}
          {status.signature ? (
            <SpecListItem label="Signed">With key {status.signature.keyId.slice(0, 12)}</SpecListItem>
          ) : null}
          {source ? (
            <SpecListItem label="Kept at">
              <a href={source} rel="noreferrer">
                {source.replace(/^https?:\/\//, '')}
              </a>
            </SpecListItem>
          ) : null}
        </SpecList>
      ) : null}

      {spec.packages.map((pkg) => (
        <PackageSection key={pkg.name} policy={policy} pkg={pkg} />
      ))}

      {settings ? (
        <Section title="Settings">
          <Collapsible>
            <CollapsibleTrigger openLabel="Hide the settings">Read the settings the rules use</CollapsibleTrigger>
            <CollapsiblePanel>
              <pre className={`${type.typeData} ${styles.code}`}>{JSON.stringify(spec.settings, null, 2)}</pre>
            </CollapsiblePanel>
          </Collapsible>
        </Section>
      ) : null}

      <Stack>
        <Note>
          Every decision is recorded. Yours are in your account, with what each one decided.
        </Note>
      </Stack>
    </Panel>
  )
}

export default function PolicyPage() {
  return (
    <Suspense>
      <PolicyDetails />
    </Suspense>
  )
}
