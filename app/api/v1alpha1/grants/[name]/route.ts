import { serve } from '@fairgarden-private/id/lib/server/api'
import { deleteGrant } from '@fairgarden-private/id/lib/server/api-account'

export const DELETE = serve(deleteGrant)
