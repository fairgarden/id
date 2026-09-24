import nodemailer, { type Transporter } from 'nodemailer'
import { getConfig } from './config.ts'
import { db } from './db.ts'
import { mockMessages } from './schema.ts'

/**
 * Sending email: over SMTP when `FG_ID_SMTP_URL` is set, and otherwise, on a
 * local host, into the mock mailbox — a table the dev mailbox page reads, so
 * a sign-in can be finished without a mail server. The link is logged too.
 *
 * On a public host without SMTP nothing is sent, because anyone who could
 * read the mock mailbox could sign in as anyone. `FG_ID_MOCK_EMAIL=true`
 * overrides that for a demo.
 */

export interface Message {
  to: string
  subject: string
  text: string
  html: string
}

export class EmailNotConfigured extends Error {
  constructor() {
    super('Email is not configured: set FG_ID_SMTP_URL')
    this.name = 'EmailNotConfigured'
  }
}

let transporter: Transporter | undefined

export const sendEmail = async (message: Message): Promise<void> => {
  const { email } = getConfig()

  if (email.smtpUrl) {
    transporter ??= nodemailer.createTransport(email.smtpUrl)
    await transporter.sendMail({ from: email.from, ...message })
    return
  }

  if (!email.mock) throw new EmailNotConfigured()
  const database = await db()
  await database.insert(mockMessages).values(message)
  const link = /https?:\/\/\S+/.exec(message.text)?.[0]
  console.info(`[id] mock email to ${message.to}: ${message.subject}${link ? `\n     ${link}` : ''}`)
}

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

/** The sign-in email: a code to type, and a link for the same browser. */
export const signInEmail = ({
  to,
  code,
  link,
  minutes,
}: {
  to: string
  code: string
  link: string
  minutes: number
}): Message => {
  const { brand } = getConfig()
  const name = escape(brand.name)
  return {
    to,
    subject: `${code} is your ${brand.name} sign-in code`,
    text: [
      `Your ${brand.name} sign-in code is ${code}.`,
      '',
      'Or open this link in the browser where you started signing in:',
      link,
      '',
      `Both expire in ${minutes} minutes. If you did not try to sign in, you can ignore this email.`,
    ].join('\n'),
    html: `<!doctype html>
<html>
  <body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 32rem; margin: 0 auto; padding: 2rem 1rem;">
    <p style="margin: 0 0 1rem;">Your ${name} sign-in code is</p>
    <p style="font-size: 2rem; font-weight: 700; letter-spacing: 0.3em; margin: 0 0 1.5rem;">${escape(code)}</p>
    <p style="margin: 0 0 1rem;">Or sign in with this link, in the browser where you started:</p>
    <p style="margin: 0 0 1.5rem;"><a href="${escape(link)}" style="display: inline-block; padding: 0.75rem 1.25rem; background: #1f6f43; color: #fff; text-decoration: none; border-radius: 0.5rem;">Sign in to ${name}</a></p>
    <p style="color: #555; font-size: 0.875rem; margin: 0;">Both expire in ${minutes} minutes. If you did not try to sign in, you can ignore this email.</p>
  </body>
</html>`,
  }
}
