import { randomUUID } from 'node:crypto'
import http from 'node:http'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import * as client from 'openid-client'

/**
 * Stands in for the services that sign in with the id service, so its
 * browser tests need nothing but itself. Two services on one server:
 *
 * - "Mock Service" (`mock`), an ordinary OIDC client: `/login` signs in,
 *   `/` shows the claims it was given, `/userinfo` asks for them again with
 *   its access token, and `/logout` signs out.
 * - "Club" (`club`), which supplies the `club` scope's claims, answering the
 *   ClaimsReviews the id service sends to /club/api/v1alpha1/claimsreviews and
 *   recording them at /club/reviews.
 *
 * Run with `node e2e/mock-service.ts`; Playwright starts it.
 */

const PORT = Number(process.env.MOCK_PORT ?? 3111)
const ID_URL = process.env.ID_URL ?? 'http://localhost:3110'
const BASE = `http://localhost:${PORT}`
const REDIRECT_URI = `${BASE}/auth/callback`

interface Session {
  idToken: string
  accessToken: string
  claims: Record<string, unknown>
  userinfo: Record<string, unknown>
}
const sessions = new Map<string, Session>()
const flows = new Map<string, { verifier: string; nonce: string }>()
const reviews: unknown[] = []

let configuration: Promise<client.Configuration> | undefined
const oidc = () =>
  (configuration ??= client
    .discovery(new URL(ID_URL), 'mock', undefined, client.ClientSecretBasic('mock-secret'), {
      execute: [client.allowInsecureRequests],
    })
    .catch((error: unknown) => {
      configuration = undefined
      throw error
    }))

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined
const idKeys = async () => (jwks ??= createRemoteJWKSet(new URL((await oidc()).serverMetadata().jwks_uri!)))

const cookie = (req: http.IncomingMessage) =>
  /(?:^|;\s*)mock_sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1]

const escape = (value: string) => value.replace(/[&<>]/g, (char) => `&#${char.charCodeAt(0)};`)

const page = (res: http.ServerResponse, body: string) => {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html><head><title>Mock Service</title></head><body><h1>Mock Service</h1>${body}</body></html>`)
}

const redirect = (res: http.ServerResponse, location: string, headers: Record<string, string> = {}) => {
  res.writeHead(303, { location, ...headers })
  res.end()
}

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const readBody = async (req: http.IncomingMessage) => {
  let body = ''
  for await (const chunk of req) body += chunk
  return body
}

const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<void>> = {
  'GET /health': async (_req, res) => json(res, 200, { ok: true }),

  'GET /': async (req, res, url) => {
    const session = sessions.get(cookie(req) ?? '')
    const error = url.searchParams.get('error')
    page(
      res,
      [
        error ? `<p id="error">${escape(error)}</p>` : '',
        session
          ? `<p id="signed-in">Signed in</p>
             <pre id="claims">${escape(JSON.stringify(session.claims, null, 2))}</pre>
             <pre id="userinfo">${escape(JSON.stringify(session.userinfo, null, 2))}</pre>
             <a href="/logout">Sign out</a>`
          : '<p id="signed-out">Signed out</p><a href="/login">Sign in</a>',
      ].join('')
    )
  },

  'GET /login': async (_req, res, url) => {
    const configuration = await oidc()
    const verifier = client.randomPKCECodeVerifier()
    const state = client.randomState()
    const nonce = client.randomNonce()
    flows.set(state, { verifier, nonce })
    const extra = Object.fromEntries(
      ['prompt', 'login_hint'].flatMap((name) =>
        url.searchParams.has(name) ? [[name, url.searchParams.get(name)!]] : []
      )
    )
    redirect(
      res,
      client
        .buildAuthorizationUrl(configuration, {
          redirect_uri: REDIRECT_URI,
          scope: url.searchParams.get('scope') ?? 'openid email profile',
          code_challenge: await client.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          state,
          nonce,
          ...extra,
        })
        .href
    )
  },

  'GET /auth/callback': async (_req, res, url) => {
    if (url.searchParams.has('error')) return redirect(res, `/?error=${url.searchParams.get('error')}`)
    const state = url.searchParams.get('state') ?? ''
    const flow = flows.get(state)
    flows.delete(state)
    if (!flow) return redirect(res, '/?error=unknown_state')
    const configuration = await oidc()
    const tokens = await client.authorizationCodeGrant(configuration, url, {
      pkceCodeVerifier: flow.verifier,
      expectedState: state,
      expectedNonce: flow.nonce,
    })
    const claims = tokens.claims()!
    const userinfo = await client.fetchUserInfo(configuration, tokens.access_token, claims.sub)
    const sid = randomUUID()
    sessions.set(sid, {
      idToken: tokens.id_token!,
      accessToken: tokens.access_token,
      claims: { ...claims },
      userinfo: { ...userinfo },
    })
    redirect(res, '/', { 'set-cookie': `mock_sid=${sid}; Path=/; HttpOnly; SameSite=Lax` })
  },

  'GET /userinfo': async (req, res) => {
    const session = sessions.get(cookie(req) ?? '')
    if (!session) return json(res, 401, { error: 'not signed in here' })
    const answer = await fetch(`${ID_URL}/oidc/me`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    json(res, 200, { status: answer.status, body: await answer.json().catch(() => null) })
  },

  'GET /logout': async (req, res) => {
    const sid = cookie(req) ?? ''
    const session = sessions.get(sid)
    sessions.delete(sid)
    const url = client.buildEndSessionUrl(await oidc(), {
      post_logout_redirect_uri: BASE,
      ...(session ? { id_token_hint: session.idToken } : {}),
    })
    redirect(res, url.href, { 'set-cookie': 'mock_sid=; Path=/; Max-Age=0' })
  },

  'POST /club/api/v1alpha1/claimsreviews': async (req, res) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    let payload
    try {
      ;({ payload } = await jwtVerify(token ?? '', await idKeys(), {
        issuer: ID_URL,
        audience: 'club',
        typ: 'fg-claims-review+jwt',
      }))
    } catch {
      return json(res, 401, { kind: 'Status', code: 401 })
    }
    const review = JSON.parse(await readBody(req))
    if (review.request.uid !== payload.jti || review.request.subject !== payload.sub) {
      return json(res, 403, { kind: 'Status', code: 403 })
    }
    reviews.push(review.request)
    json(res, 200, {
      apiVersion: review.apiVersion,
      kind: 'ClaimsReview',
      response: {
        uid: review.request.uid,
        claims: { club: { level: 'gold', since: '2020-01-01' } },
        reasons: { 'club.handicap': 'Handicaps stay in the clubhouse.' },
      },
    })
  },

  'GET /club/reviews': async (_req, res, url) => {
    const subject = url.searchParams.get('subject')
    json(res, 200, reviews.filter((review) => !subject || (review as { subject: string }).subject === subject))
  },
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', BASE)
    const route = routes[`${req.method} ${url.pathname}`]
    if (!route) return json(res, 404, { error: 'not found' })
    try {
      await route(req, res, url)
    } catch (error) {
      console.error('[mock-service]', error)
      json(res, 500, { error: String(error) })
    }
  })
  .listen(PORT, () => console.info(`[mock-service] on ${BASE}, signing in with ${ID_URL}`))
