import { serve } from '@fairgarden-private/id/lib/server/api'
import { listGrants } from '@fairgarden-private/id/lib/server/api-account'

export const GET = serve(listGrants)
