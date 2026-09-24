import type { IncomingMessage, ServerResponse } from 'node:http'
import type Provider from 'oidc-provider'
import type * as z from 'zod'
import type { AuthorizationInput } from './policy.ts'

/**
 * One operation of the REST API: enough to serve it, to list it in API
 * discovery, and to describe it in the OpenAPI document.
 */

export interface RouteContext {
  request: Request
  /** Placeholders from the path: `name`, for `{name}`. */
  params: Record<string, string>
  provider: Provider
  /** The request, as oidc-provider reads it. */
  oidc: { req: IncomingMessage; res: ServerResponse }
}

export type RouteResult = { status: number; body: unknown } | { redirect: string }

export interface RouteDefinition<Body extends z.ZodType> {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** Below `/apis/<group>/<version>/`, as `<resource>[/{name}[/<subresource>]]`. */
  path: string
  /** The Kubernetes verb, for discovery and for policy. */
  verb: AuthorizationInput['verb']
  operationId: string
  summary: string
  description?: string
  /** How the caller is identified, for the OpenAPI document. */
  security: 'session' | 'interaction' | 'none'
  body?: Body
  contentTypes?: string[]
  responses: Record<number, { description: string; schema?: z.ZodType }>
  handle(context: RouteContext, body: z.infer<Body>): Promise<RouteResult>
}

// Handlers are checked where they are defined; the table only needs the shape.
export type Route = RouteDefinition<any>

export const defineRoute = <Body extends z.ZodType = z.ZodUndefined>(
  route: RouteDefinition<Body>
): Route => route
