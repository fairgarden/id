import { serve } from '@fairgarden/id/lib/server/api'
import { deleteGrant } from '@fairgarden/id/lib/server/api-account'

export const DELETE = serve(deleteGrant)
