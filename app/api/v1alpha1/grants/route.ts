import { serve } from '@fairgarden/id/lib/server/api'
import { listGrants } from '@fairgarden/id/lib/server/api-account'

export const GET = serve(listGrants)
