import { serve } from '@fairgarden/id/lib/server/api'
import { readSession } from '@fairgarden/id/lib/server/api-account'

export const GET = serve(readSession)
