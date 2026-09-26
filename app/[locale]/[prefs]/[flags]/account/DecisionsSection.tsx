'use client'

import type { PolicyDecision } from '@fairgarden/id/lib/api/schemas'
import { Link } from '@fairgarden/id/lib/link'
import { Note } from '@fairgarden/id/lib/ui/Panel'
import styles from './account.module.css'

const when = (value: string | undefined) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''

/**
 * What policy decided each time a service asked for something about this
 * person, from the same record an audit reads.
 */
export function DecisionsSection({ decisions }: { decisions: PolicyDecision[] }) {
  const policy = <Link href="/policy">Read the policy</Link>
  if (decisions.length === 0) return <Note>No service has asked for anything yet. {policy} that decides.</Note>
  return (
    <>
      <ul className={styles.list}>
        {decisions.map((decision) => (
          <li key={decision.metadata.name} className={styles.row}>
            <div className={styles.rowBody}>
              <span>{decision.status.summary}</span>
              <span className={styles.muted}>
                {when(decision.metadata.creationTimestamp)}
                {/* The rules that made it; a decision that could not be made had none. */}
                {decision.status.engine === 'bundle' && decision.status.error === null ? (
                  <>
                    {' · '}
                    <Link href={`/policy?revision=${encodeURIComponent(decision.status.revision)}`}>
                      Policy {decision.status.revision}
                    </Link>
                  </>
                ) : null}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <Note>Every decision is recorded, and kept for audits. {policy} that made them.</Note>
    </>
  )
}
