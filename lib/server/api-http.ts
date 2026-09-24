import type { IncomingMessage, ServerResponse } from 'node:http'
import type * as z from 'zod'
import { getConfig } from './config.ts'
import { ApiError } from './errors.ts'

/**
 * The plumbing under the REST API, which Next serves as route handlers: a
 * Web `Request` in, a `Response` out.
 */

const MAX_BODY = 256 * 1024
const JSON_TYPES = ['application/json', 'application/merge-patch+json']

export const readBody = async (request: Request, accepted = JSON_TYPES): Promise<unknown> => {
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!accepted.includes(type)) {
    throw new ApiError(415, 'UnsupportedMediaType', `Send ${accepted.join(' or ')}.`)
  }
  const text = await request.text()
  if (text.length > MAX_BODY) throw new ApiError(413, 'BadRequest', 'The request body is too large.')
  try {
    return JSON.parse(text || 'null')
  } catch {
    throw new ApiError(400, 'BadRequest', 'The request body is not valid JSON.')
  }
}

export const parse = <T extends z.ZodType>(schema: T, value: unknown, prefix?: string): z.infer<T> => {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new ApiError(422, 'Invalid', result.error.issues[0]?.message ?? 'The request is not valid.', {
    causes: result.error.issues.map((issue) => ({
      field: [prefix, ...issue.path].filter((part) => part !== undefined).join('.'),
      reason: issue.code,
      message: issue.message,
    })),
  })
}

const requestHost = (request: Request) =>
  request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host

/**
 * Cookies authenticate these requests, so a request from another site must
 * not act on them. Browsers send `Origin` with every such request; a request
 * without one did not come from a page on another site.
 */
export const assertSameOrigin = (request: Request): void => {
  const origin = request.headers.get('origin')
  if (!origin) return
  const { origin: issuerOrigin, passkeys } = getConfig()
  let sameHost = false
  try {
    sameHost = new URL(origin).host === requestHost(request)
  } catch {
    sameHost = false
  }
  if (!sameHost && origin !== issuerOrigin && !passkeys.origins.includes(origin)) {
    throw new ApiError(403, 'Forbidden', 'Cross-site requests are not accepted.')
  }
}

export const prefersHtml = (request: Request): boolean => {
  const accept = request.headers.get('accept') ?? ''
  return accept.includes('text/html') && !accept.startsWith('application/json')
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...headers } })

export const redirect = (location: string) =>
  new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } })

export const errorResponse = (error: unknown): Response => {
  if (error instanceof ApiError) {
    const retry = error.details?.retryAfterSeconds
    return json(error.code, error.toStatus(), retry ? { 'Retry-After': String(retry) } : {})
  }
  console.error('[id] request failed', error)
  return json(500, new ApiError(500, 'InternalError', 'Something went wrong.').toStatus())
}

/**
 * What oidc-provider needs to find an interaction or a session from a
 * request: it only reads the cookies and the forwarded protocol, so the
 * response side goes nowhere.
 */
export const forOidcProvider = (
  request: Request
): { req: IncomingMessage; res: ServerResponse } => {
  const url = new URL(request.url)
  const req = {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers: Object.fromEntries(request.headers),
    socket: {},
    connection: {},
  }
  const res = {
    statusCode: 200,
    headersSent: false,
    getHeader: () => undefined,
    getHeaders: () => ({}),
    setHeader: () => undefined,
    removeHeader: () => undefined,
    hasHeader: () => false,
  }
  return { req: req as unknown as IncomingMessage, res: res as unknown as ServerResponse }
}

/** Apply a JSON merge patch (RFC 7386). */
export const mergePatch = (target: unknown, patch: unknown): unknown => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const result: Record<string, unknown> =
    target && typeof target === 'object' && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key]
    else result[key] = mergePatch(result[key], value)
  }
  return result
}
