import { serve } from '@fairgarden-private/id/lib/server/api'
import { deletePasskey, patchPasskey } from '@fairgarden-private/id/lib/server/api-account'

export const PATCH = serve(patchPasskey)
export const DELETE = serve(deletePasskey)
