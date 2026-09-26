'use client'

import { useCallback, useEffect, useState } from 'react'
import { Alert } from '@fairgarden/design/feedback/alert'
import { Button } from '@fairgarden/design/actions/button'
import type { MockMessageList } from '@fairgarden/id/lib/api/schemas'
import { ApiFailure, call, messageOf } from '@fairgarden/id/lib/client/api'
import { Note, Panel, Section, Stack } from '@fairgarden/id/lib/ui/Panel'
import styles from './mailbox.module.css'

const linkIn = (text: string) => /https?:\/\/\S+/.exec(text)?.[0]

/**
 * The mock mailbox: every email this service would have sent, while it runs
 * on a local host without SMTP. Checks for new mail every few seconds.
 */
export default function Mailbox() {
  const [messages, setMessages] = useState<MockMessageList['items']>()
  const [error, setError] = useState<{ message: string; off: boolean }>()

  const load = useCallback(async () => {
    try {
      const { items } = await call<MockMessageList>('mockmessages')
      setMessages(items)
      setError(undefined)
    } catch (failure) {
      setError({ message: messageOf(failure), off: failure instanceof ApiFailure && failure.code === 404 })
    }
  }, [])

  // Check now, then every few seconds, for mail a sign-in just sent.
  useEffect(() => {
    const timer = window.setInterval(load, 3000)
    const first = window.setTimeout(load, 0)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(first)
    }
  }, [load])

  const empty = async () => {
    await call('mockmessages', { method: 'DELETE' })
    await load()
  }

  if (error?.off) {
    return (
      <Panel title="Mock mailbox" lede="Email is really sent here, so there is nothing to show.">
        <Note>The mock mailbox is only used on a local host without FG_ID_SMTP_URL.</Note>
      </Panel>
    )
  }

  return (
    <Panel wide title="Mock mailbox" lede="What would have been emailed, newest first. Sign-in links only work in the browser that asked for them.">
      {error ? <Alert status="danger">{error.message}</Alert> : null}
      <Stack row>
        <Button onClick={empty} disabled={!messages?.length}>
          Empty the Mailbox
        </Button>
      </Stack>
      {messages?.length === 0 ? <Note>Nothing yet.</Note> : null}
      {messages?.map((message) => {
        const link = linkIn(message.spec.text)
        return (
          <Section key={message.metadata.name} title={message.spec.subject}>
            <p className={styles.meta}>
              To {message.spec.to},{' '}
              {new Date(message.metadata.creationTimestamp ?? '').toLocaleTimeString()}
            </p>
            <pre className={styles.body}>{message.spec.text}</pre>
            {link ? (
              <Stack row>
                <Button variant="solid" render={<a href={link} />} nativeButton={false}>
                  Open the Link
                </Button>
              </Stack>
            ) : null}
          </Section>
        )
      })}
    </Panel>
  )
}
