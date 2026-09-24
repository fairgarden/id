import { mountPrefix } from '@fairgarden/monolith/link'
import { resourcePath } from '@fairgarden-private/id/lib/api/group'
import type { Status } from '@fairgarden-private/id/lib/api/schemas'

/** Where this app is mounted in a monolith, or `''` on its own. */
export const MOUNT = mountPrefix('@fairgarden-private/id')

/** A request the API refused, with the `Status` it said why in. */
export class ApiFailure extends Error {
  readonly status: Status

  constructor(status: Status) {
    super(status.message ?? 'Something went wrong.')
    this.name = 'ApiFailure'
    this.status = status
  }

  get code() {
    return this.status.code
  }

  /** The message for one field, when the API blamed it. */
  field(name: string): string | undefined {
    return this.status.details?.causes?.find((cause) => cause.field === name)?.message
  }
}

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Send the body as a JSON merge patch. */
  merge?: boolean
}

/** Call the REST API, by path below `/api/<version>/`. */
export const call = async <T>(path: string, { method = 'GET', body, merge }: CallOptions = {}): Promise<T> => {
  let response: Response
  try {
    response = await fetch(resourcePath(MOUNT, path), {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined
          ? { 'content-type': merge ? 'application/merge-patch+json' : 'application/json' }
          : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiFailure({
      apiVersion: 'v1',
      kind: 'Status',
      metadata: {},
      status: 'Failure',
      code: 0,
      reason: 'ServiceUnavailable',
      message: 'Could not reach the server. Check your connection and try again.',
    })
  }
  const json = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new ApiFailure(
      json?.kind === 'Status'
        ? json
        : {
            apiVersion: 'v1',
            kind: 'Status',
            metadata: {},
            status: 'Failure',
            code: response.status,
            message: 'Something went wrong. Try again.',
          }
    )
  }
  return json as T
}

/** A message fit to show, whatever was thrown. */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong. Try again.'
