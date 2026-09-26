import { serve } from '@fairgarden/id/lib/server/api'
import { readPolicy } from '@fairgarden/id/lib/server/api-policy'

export const GET = serve(readPolicy)
