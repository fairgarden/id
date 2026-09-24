import { serve } from '@fairgarden-private/id/lib/server/api'
import { readSession } from '@fairgarden-private/id/lib/server/api-account'

export const GET = serve(readSession)
