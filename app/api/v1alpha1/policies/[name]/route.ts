import { serve } from '@fairgarden-private/id/lib/server/api'
import { readPolicy } from '@fairgarden-private/id/lib/server/api-policy'

export const GET = serve(readPolicy)
