import type { ReactNode } from 'react'
import { Card } from '@fairgarden/design/content/card'
import type from '@fairgarden/design/utils/type.module.css'
import styles from './panel.module.css'

/**
 * The frame every page here shares: one faced card in the middle of the
 * page, headed by the service's name.
 */
export function Panel({
  eyebrow,
  title,
  lede,
  wide = false,
  children,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  lede?: ReactNode
  wide?: boolean
  children?: ReactNode
}) {
  return (
    <main className={styles.main}>
      <Card faced className={wide ? styles.wide : styles.narrow}>
        <div className={styles.stack}>
          <header className={styles.header}>
            {eyebrow ? <p className={type.typeEyebrow}>{eyebrow}</p> : null}
            <h1 className={type.typeH2}>{title}</h1>
            {lede ? <p className={type.typeLead}>{lede}</p> : null}
          </header>
          {children}
        </div>
      </Card>
    </main>
  )
}

/** A titled part of a page. */
export function Section({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={type.typeSubhead}>{title}</h2>
      {children}
    </section>
  )
}

/** Lay children out in a column, or a wrapping row. */
export function Stack({ row = false, children }: { row?: boolean; children?: ReactNode }) {
  return <div className={row ? styles.row : styles.stack}>{children}</div>
}

/** Small print under a form. */
export function Note({ children }: { children?: ReactNode }) {
  return <p className={`${type.typeSmall} ${styles.note}`}>{children}</p>
}
