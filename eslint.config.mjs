import next from 'eslint-config-next/core-web-vitals'
import prettier from 'eslint-config-prettier/flat'
import n from 'eslint-plugin-n'
import noRelativeImportPaths from 'eslint-plugin-no-relative-import-paths'
import monolith from '@fairgarden/monolith/eslint'

/** @type {import('eslint').Linter.Config[]} */
const config = [
  // docs/ is its own workspace package and lints itself
  { ignores: ['node_modules/**', 'dist/**', '.next/**', 'docs/**', 'playwright-report/**', 'test-results/**'] },
  ...next,
  prettier,
  ...monolith.configs.recommended,
  {
    plugins: { 'no-relative-import-paths': noRelativeImportPaths },
    rules: {
      'no-relative-import-paths/no-relative-import-paths': [
        'warn',
        { allowSameFolder: true, prefix: '@fairgarden-private/id' },
      ],
    },
  },
  {
    files: ['app/**', 'pages/**'],
    plugins: { n },
    rules: {
      'n/no-restricted-import': [
        'error',
        [
          {
            name: [
              '**',
              '!./**',
              '!../**',
              '!react',
              '!react/**',
              '!next',
              '!next/**',
              '!@fairgarden-private/id/**',
              '!@fairgarden/design/**',
            ],
            message: 'External modules are not allowed.',
          },
        ],
      ],
    },
  },
]

export default config
