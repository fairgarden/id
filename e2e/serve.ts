import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'

/**
 * The id service as the browser tests see it: built for production (the
 * bundle is where the worst bugs hide) and served on its own port, with a
 * fresh embedded database every run. `E2E_DEV=1` serves `next dev` instead,
 * which starts faster while writing tests.
 *
 * `E2E_POLICY` names an organization's layer to build on id's own rules and
 * run, as a deployment would; otherwise the built-in rules decide.
 */

const ROOT = path.resolve(import.meta.dirname, '..')
const PORT = process.env.ID_PORT ?? '3110'
const dev = process.env.E2E_DEV === '1'

rmSync(path.join(ROOT, 'e2e', '.data'), { recursive: true, force: true })

const next = (args: string[]) => [path.join(ROOT, 'node_modules', '.bin', 'next'), args] as const

const env: Record<string, string> = { FG_POLICY_BUNDLE: 'none' }
if (process.env.E2E_POLICY) {
  const bundle = path.join('e2e', '.data', 'policies.tar.gz')
  const built = spawnSync(
    path.join(ROOT, 'node_modules', '.bin', 'fg-policy'),
    ['build', '--base', 'policies', '--dir', process.env.E2E_POLICY, '--out', bundle],
    { cwd: ROOT, stdio: 'inherit' }
  )
  if (built.status !== 0) process.exit(built.status ?? 1)
  // Built here from the repository, as a deployment's is, so unsigned.
  Object.assign(env, { FG_POLICY_BUNDLE: bundle, FG_POLICY_ALLOW_UNSIGNED: 'true' })
}

if (!dev) {
  const [command, args] = next(['build'])
  const built = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' })
  if (built.status !== 0) process.exit(built.status ?? 1)
}

const [command, args] = next([dev ? 'dev' : 'start', '-p', PORT])
const server = spawn(command, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } })
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.kill(signal))
}
server.on('exit', (code) => process.exit(code ?? 0))
