import { execFileSync, spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toEntry } from '@fairgarden/policy/drizzle'
import type { AuthorizationInput } from '@fairgarden-private/id/lib/server/policy'
import { ROOT, useDatabase } from './helpers/database'

const passkeys = (owner?: string): AuthorizationInput['resource'] => ({
  group: 'id.fairgarden.org',
  version: 'v1alpha1',
  resource: 'passkeys',
  ...(owner ? { owner } : {}),
})
const person = (name: string | null) => ({ name, authenticated: name !== null })

const load = async (env: Record<string, string> = {}) => {
  vi.resetModules()
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FG_POLICY_') || key === 'FG_ID_POLICY_PACKAGE') delete process.env[key]
  }
  // Whatever a build left in .policy/, each test says which policy it means.
  Object.assign(process.env, env.FG_POLICY_BUNDLE || env.FG_POLICY_OPA_URL ? {} : { FG_POLICY_BUNDLE: 'none' }, env)
  return import('@fairgarden-private/id/lib/server/policy')
}

/** What was recorded about someone, oldest first, as OPA would log it. */
const recorded = async (subject: string) => {
  const { db } = await import('@fairgarden-private/id/lib/server/db')
  const { policyDecisions } = await import('@fairgarden-private/id/lib/server/schema')
  const rows = await (await db())
    .select()
    .from(policyDecisions)
    .where(eq(policyDecisions.subject, subject))
    .orderBy(asc(policyDecisions.decidedAt))
  return rows.map(toEntry)
}

/** The decisions every engine has to agree on: the starter policy is the built-in rules. */
const agreesWithTheBuiltInRules = async (policy: Awaited<ReturnType<typeof load>>) => {
  expect(
    await policy.authorize({ user: person(null), verb: 'get', resource: { ...passkeys(), resource: 'sessions' } })
  ).toMatchObject({ allowed: true })
  expect(await policy.authorize({ user: person(null), verb: 'list', resource: passkeys('a') })).toMatchObject({
    allowed: false,
  })
  expect(await policy.authorize({ user: person('a'), verb: 'list', resource: passkeys('a') })).toMatchObject({
    allowed: true,
  })
  expect(await policy.authorize({ user: person('b'), verb: 'delete', resource: passkeys('a') })).toEqual({
    allowed: false,
    reason: 'That belongs to someone else.',
  })
  expect(
    await policy.decideRelease({ user: { name: 'a' }, client: { id: 'x', name: 'X' }, scopes: ['openid', 'phone'], purpose: 'Consent' })
  ).toEqual({ scopes: ['openid', 'phone'], reasons: {} })
}

describe('policy decisions', () => {
  useDatabase()
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('come from the built-in rules, and every one is recorded', async () => {
    const policy = await load()
    await agreesWithTheBuiltInRules(policy)

    const b = await recorded('b')
    expect(b).toEqual([
      {
        decision_id: expect.any(String),
        path: 'fairgarden/id/authz',
        input: { user: { name: 'b', authenticated: true }, verb: 'delete', resource: passkeys('a') },
        result: { allow: false, reason: 'That belongs to someone else.' },
        timestamp: expect.any(String),
        labels: { service: 'id', engine: 'builtin', revision: 'builtin' },
        metrics: { timer_rego_query_eval_ns: expect.any(Number) },
      },
    ])
    expect((await recorded('a')).map((entry) => entry.path)).toEqual([
      'fairgarden/id/authz',
      'fairgarden/id/release',
    ])
  })

  describe('from an OPA server', () => {
    let server: http.Server
    let url: string

    beforeEach(async () => {
      server = http.createServer(async (req, res) => {
        let body = ''
        for await (const chunk of req) body += chunk
        const { input } = JSON.parse(body)
        res.setHeader('content-type', 'application/json')
        if (req.url === '/v1/data/fairgarden/id/release') {
          // Keep phone numbers from everyone, and say why.
          res.end(JSON.stringify({
            result: {
              scopes: input.scopes.filter((scope: string) => scope !== 'phone'),
              reasons: { phone: 'Phone numbers stay here.' },
            },
          }))
          return
        }
        res.end(JSON.stringify({ result: { allow: input.user.authenticated } }))
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })
    afterEach(() => {
      server.close()
    })

    it('are asked of it, with its reasons passed on and recorded', async () => {
      const policy = await load({ FG_POLICY_OPA_URL: url })
      expect(
        await policy.decideRelease({ user: { name: 'c' }, client: { id: 'x', name: 'X' }, scopes: ['openid', 'email', 'phone'], purpose: 'Preview' })
      ).toEqual({ scopes: ['openid', 'email'], reasons: { phone: 'Phone numbers stay here.' } })
      const [entry] = await recorded('c')
      expect(entry).toMatchObject({
        path: 'fairgarden/id/release',
        result: { reasons: { phone: 'Phone numbers stay here.' } },
        labels: { engine: 'server', revision: `server ${url}` },
      })
    })

    it('are no when it cannot be asked, and the failure is recorded', async () => {
      server.close()
      const policy = await load({ FG_POLICY_OPA_URL: url })
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      await expect(
        policy.authorize({ user: person('d'), verb: 'list', resource: passkeys('d') })
      ).rejects.toMatchObject({ code: 503 })
      const [entry] = await recorded('d')
      expect(entry.error).toBeTruthy()
      expect(entry).not.toHaveProperty('result')
    })
  })

  // The shipped Rego, built into a signed bundle and run the way a deployment
  // runs the organization's. Needs the opa CLI to build, so it is skipped
  // where there is none.
  const opa = process.env.OPA ?? 'opa'
  const hasOpa = spawnSync(opa, ['version']).status === 0

  describe.skipIf(!hasOpa)("from the organization's bundle", () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const organizationKey = publicKey.export({ type: 'spki', format: 'pem' }).toString()

    /** policies/ as id ships it, with an organization's on top: examples/privacy, or just a .manifest. */
    const build = ({ privacy = false } = {}) => {
      const root = mkdtempSync(path.join(tmpdir(), 'policy-'))
      cpSync(path.join(ROOT, 'policies'), path.join(root, 'apps/id/policies'), { recursive: true })
      if (privacy) cpSync(path.join(ROOT, 'examples/privacy'), path.join(root, 'policies'), { recursive: true })
      else {
        mkdirSync(path.join(root, 'policies'))
        writeFileSync(path.join(root, 'policies/.manifest'), '{"metadata":{"organization":"Test Club"}}')
      }
      writeFileSync(path.join(root, 'key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }))
      execFileSync(
        path.join(ROOT, 'node_modules', '.bin', 'fg-policy'),
        ['build', '--base', 'apps/*/policies', '--release', '2026.10.01', '--signing-key', 'key.pem'],
        { cwd: root, env: { ...process.env, OPA: opa }, stdio: 'ignore' }
      )
      return path.join(root, 'policies.tar.gz')
    }

    it('agree with the built-in rules, as id ships them', async () => {
      const bundle = build()
      await agreesWithTheBuiltInRules(await load({ FG_POLICY_BUNDLE: bundle, FG_POLICY_PUBLIC_KEY: organizationKey }))
      // Named by what is in it, after the release it belongs to.
      expect((await recorded('b')).at(-1)?.labels).toMatchObject({
        engine: 'bundle',
        revision: expect.stringMatching(/^2026\.10\.01\+[0-9a-f]{12}$/),
      })
    })

    it("follow an organization's rules, and say why", async () => {
      const bundle = build({ privacy: true })
      const policy = await load({ FG_POLICY_BUNDLE: bundle, FG_POLICY_PUBLIC_KEY: organizationKey })
      const asked = ['openid', 'residential_address']
      expect(
        await policy.decideRelease({ user: { name: 'e' }, client: { id: 'events', name: 'Events' }, scopes: asked, purpose: 'Preview' })
      ).toEqual({ scopes: ['openid'], reasons: { residential_address: 'Only Members may ask where you live.' } })
      expect(
        await policy.decideRelease({ user: { name: 'e' }, client: { id: 'members', name: 'Members' }, scopes: asked, purpose: 'Preview' })
      ).toEqual({ scopes: asked, reasons: {} })

      const { disclosure } = await policy.currentPolicy()
      const revision = disclosure!.revision
      expect(disclosure).toMatchObject({
        revision: expect.stringMatching(/^2026\.10\.01\+[0-9a-f]{12}$/),
        organization: { organization: 'Example Club' },
        layers: [{ path: 'apps/id/policies', role: 'base' }, { path: 'policies', role: 'organization' }],
      })
      expect(disclosure?.packages[0].sources.map((source) => source.path)).toEqual([
        'apps/id/policies/id.rego',
        'policies/fairgarden/id/privacy.rego',
      ])
      expect(disclosure?.packages[0].decisions.map((decision) => decision.title)).toEqual([
        'Who may see and change an account',
        'What a service may ask you for',
      ])

      // Kept, so a decision it made can be read beside it after it is replaced.
      expect(await policy.pastPolicy(revision)).toMatchObject({
        engine: 'bundle',
        disclosure: { revision, organization: { organization: 'Example Club' } },
        firstUsedAt: expect.any(Date),
      })
      expect(await policy.pastPolicy('2020.01.01+000000000000')).toBeUndefined()
    })

    it("are refused when not signed by the organization, and the policy says so", async () => {
      const bundle = build()
      const stranger = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'pem' }).toString()
      const policy = await load({ FG_POLICY_BUNDLE: bundle, FG_POLICY_PUBLIC_KEY: stranger })
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      await expect(policy.authorize({ user: person('f'), verb: 'list', resource: passkeys('f') })).rejects.toMatchObject({
        code: 503,
      })
      expect(await policy.currentPolicy()).toEqual({
        engine: 'bundle',
        refused: "The bundle's signature is not the organization's.",
      })
    })
  })
})
