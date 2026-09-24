import * as z from 'zod'
import { API_GROUP, API_VERSION, GROUP_VERSION } from '@fairgarden-private/id/lib/api/group'
import { ClaimsReview, registry, Status } from '@fairgarden-private/id/lib/api/schemas'
import { sessionRoutes } from './api-account.ts'
import {
  assertSameOrigin,
  errorResponse,
  forOidcProvider,
  json,
  parse,
  readBody,
  redirect,
} from './api-http.ts'
import { interactionRoutes } from './api-interactions.ts'
import { policyRoutes } from './api-policy.ts'
import type { Route } from './api-route.ts'
import { getConfig } from './config.ts'
import { getProvider } from './provider.ts'

/**
 * The REST API, served Kubernetes style by route files under `app/api/`:
 *
 * - `/api` and `/api/v1alpha1` for discovery
 * - `/api/v1alpha1/<resource>[/<name>[/<subresource>]]` for objects
 * - `/api/openapi/v3` for the OpenAPI document
 *
 * Each route file exports `serve(<route>)` for its methods; the routes
 * themselves, and what the OpenAPI document says about them, are in
 * `api-interactions.ts`, `api-account.ts` and `api-policy.ts`.
 */

export const ROUTES: Route[] = [...interactionRoutes, ...sessionRoutes, ...policyRoutes]

type Params = Promise<Record<string, string | string[] | undefined> | undefined>

/** A Next route handler for one operation. */
export const serve =
  (route: Route) =>
  async (request: Request, { params }: { params: Params }): Promise<Response> => {
    try {
      // Cookies authenticate every change, so none may come from another site.
      if (route.method !== 'GET') assertSameOrigin(request)
      const resolved = Object.fromEntries(
        // A route without dynamic segments has no params at all.
        Object.entries((await params) ?? {}).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.join('/') : (value ?? ''),
        ])
      )
      const body = route.body
        ? parse(route.body, await readBody(request, route.contentTypes ?? ['application/json']))
        : undefined
      const provider = await getProvider()
      const result = await route.handle(
        { request, params: resolved, provider, oidc: forOidcProvider(request) },
        body
      )
      return 'redirect' in result ? redirect(result.redirect) : json(result.status, result.body)
    } catch (error) {
      return errorResponse(error)
    }
  }

/** The kind each resource and subresource is about, for discovery. */
const KINDS: Record<string, string> = {
  interactions: 'Interaction',
  'interactions/emailchallenge': 'EmailChallenge',
  'interactions/passkeychallenge': 'PasskeyChallenge',
  'interactions/login': 'Login',
  'interactions/account': 'Account',
  'interactions/passkeys': 'Passkey',
  'interactions/consent': 'Consent',
  sessions: 'Session',
  accounts: 'Account',
  passkeys: 'Passkey',
  passkeychallenges: 'PasskeyChallenge',
  grants: 'Grant',
  mockmessages: 'MockMessage',
  policydecisions: 'PolicyDecision',
  policies: 'Policy',
}

/** `interactions/{name}/login` -> `interactions/login` */
const resourceOf = (route: Route) => route.path.replace('/{name}', '')

/** `GET /api`: the versions served. */
export const apiVersions = () =>
  json(200, { apiVersion: 'v1', kind: 'APIVersions', versions: [API_VERSION] })

/** `GET /api/<version>`: the resources, and what can be done to each. */
export const apiResources = () => {
  const verbs = new Map<string, Set<string>>()
  for (const route of ROUTES) {
    const name = resourceOf(route)
    if (!verbs.has(name)) verbs.set(name, new Set())
    verbs.get(name)!.add(route.verb)
  }
  return json(200, {
    apiVersion: 'v1',
    kind: 'APIResourceList',
    groupVersion: GROUP_VERSION,
    resources: [...verbs].map(([name, resourceVerbs]) => ({
      name,
      singularName: name.includes('/') ? '' : (KINDS[name]?.toLowerCase() ?? ''),
      namespaced: false,
      group: API_GROUP,
      version: API_VERSION,
      kind: KINDS[name] ?? '',
      verbs: [...resourceVerbs],
    })),
  })
}

const ref = (schema: z.ZodType) => {
  const id = registry.get(schema)?.id
  return id ? { $ref: `#/components/schemas/${id}` } : z.toJSONSchema(schema)
}

const SECURITY: Record<Route['security'], Array<Record<string, string[]>>> = {
  session: [{ session: [] }],
  interaction: [{ interaction: [] }],
  none: [],
}

/** `GET /api/openapi/v3`: the OpenAPI 3.1 document. */
export const openApiDocument = () => {
  const { brand, issuer } = getConfig()
  const { schemas } = z.toJSONSchema(registry, {
    uri: (id) => `#/components/schemas/${id}`,
    unrepresentable: 'any',
  }) as { schemas: Record<string, Record<string, unknown>> }
  for (const schema of Object.values(schemas)) {
    delete schema.$schema
    delete schema.$id
  }

  const paths: Record<string, Record<string, unknown>> = {}
  for (const route of ROUTES) {
    const path = `/api/${API_VERSION}/${route.path}`
    paths[path] ??= {}
    paths[path][route.method.toLowerCase()] = {
      operationId: route.operationId,
      summary: route.summary,
      ...(route.description ? { description: route.description } : {}),
      tags: [resourceOf(route).split('/')[0]],
      ...(route.path.includes('{name}')
        ? { parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }] }
        : {}),
      ...(route.body
        ? {
            requestBody: {
              required: true,
              content: Object.fromEntries(
                (route.contentTypes ?? ['application/json']).map((type) => [
                  type,
                  { schema: ref(route.body!) },
                ])
              ),
            },
          }
        : {}),
      responses: {
        ...Object.fromEntries(
          Object.entries(route.responses).map(([code, response]) => [
            code,
            {
              description: response.description,
              ...(response.schema
                ? { content: { 'application/json': { schema: ref(response.schema) } } }
                : {}),
            },
          ])
        ),
        default: {
          description: 'An error',
          content: { 'application/json': { schema: ref(Status) } },
        },
      },
      security: SECURITY[route.security],
      'x-kubernetes-action': route.verb,
      'x-kubernetes-group-version-kind': {
        group: API_GROUP,
        version: API_VERSION,
        kind: KINDS[resourceOf(route)] ?? '',
      },
    }
  }

  return json(200, {
    openapi: '3.1.0',
    info: {
      title: `${brand.name} identity API`,
      version: API_VERSION,
      description:
        'Signing in, and what a person shares with each service. Resources follow Kubernetes API conventions; every error is a Status.',
    },
    servers: [{ url: issuer }],
    paths,
    webhooks: {
      claimsReview: {
        post: {
          summary: 'Supply claims this service does not keep',
          description:
            'Sent to a service enrolled with FG_ID_SERVICE_<NAME>_CLAIMS, at FG_ID_SERVICE_<NAME>_CLAIMS_ENDPOINT (default `<url>/api/v1alpha1/claimsreviews`), when a person releases one of its scopes to another service or is shown what they would release. Answer with the same object, with `response.uid` echoing `request.uid` and `response.claims` holding the claims. Verify the bearer token against this service’s JWKS: `typ` is `fg-claims-review+jwt`, `aud` is your client ID, and `jti` and `sub` match the request.',
          security: [{ claimsReviewToken: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref(ClaimsReview) } },
          },
          responses: {
            200: {
              description: 'The claims',
              content: { 'application/json': { schema: ref(ClaimsReview) } },
            },
          },
        },
      },
    },
    components: {
      schemas,
      securitySchemes: {
        session: {
          type: 'apiKey',
          in: 'cookie',
          name: 'fg_id_session',
          description: 'Signed in to this service, in a browser.',
        },
        interaction: {
          type: 'apiKey',
          in: 'cookie',
          name: 'fg_id_interaction',
          description: 'The browser that started this sign-in.',
        },
        claimsReviewToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Signed by this service with its token signing key.',
        },
      },
    },
  })
}
