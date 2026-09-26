'use client'

import { createNavigation } from '@fairgarden/indicators/link'
import { mountPrefix } from '@fairgarden/monolith/link'
import { indicators } from '@fairgarden/id/lib/indicators'

// Use these instead of next/link, so hrefs carry the locale and, when this
// app is served inside a monolith, its mount point.
export const { Link, useHref, useIndicators, useLocale, usePref } = createNavigation(
  indicators,
  { mount: mountPrefix('@fairgarden/id') }
)
