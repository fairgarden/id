'use client'

import { Fieldset, FieldsetLegend } from '@fairgarden/design/forms/fieldset'
import { Radio } from '@fairgarden/design/forms/radio'
import { RadioGroup } from '@fairgarden/design/forms/radio-group'
import { usePref } from '@fairgarden-private/id/lib/link'

const SYSTEM = 'system'

/**
 * Sets the `theme` preference.
 *
 * The cookie decides which prerendered variant the next request is rewritten
 * to, so choosing a theme refreshes the route rather than toggling a class:
 * the page that comes back already has `data-theme` on `<html>`.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = usePref('theme')

  return (
    <Fieldset>
      <FieldsetLegend>Theme</FieldsetLegend>
      <RadioGroup
        aria-label="Theme"
        value={theme ?? SYSTEM}
        onValueChange={(value) =>
          setTheme(value === SYSTEM ? undefined : (value as 'light' | 'dark'))
        }
      >
        <Radio value={SYSTEM}>Match This Device</Radio>
        <Radio value="light">Light</Radio>
        <Radio value="dark">Dark</Radio>
      </RadioGroup>
    </Fieldset>
  )
}
