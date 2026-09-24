import type { Status, StatusReason } from '@fairgarden-private/id/lib/api/schemas'

/**
 * A request that cannot be served, and why. The API sends it as a Kubernetes
 * `Status`, so every error has the same shape whichever endpoint raised it.
 */
export class ApiError extends Error {
  readonly code: number
  readonly reason: StatusReason
  readonly details: Status['details']

  constructor(code: number, reason: StatusReason, message: string, details?: Status['details']) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.reason = reason
    this.details = details
  }

  toStatus(): Status {
    return {
      apiVersion: 'v1',
      kind: 'Status',
      metadata: {},
      status: 'Failure',
      message: this.message,
      reason: this.reason,
      code: this.code,
      ...(this.details ? { details: this.details } : {}),
    }
  }
}

export const invalid = (field: string, message: string): ApiError =>
  new ApiError(422, 'Invalid', message, {
    causes: [{ field, reason: 'FieldValueInvalid', message }],
  })
