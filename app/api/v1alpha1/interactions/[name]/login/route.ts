import { serve } from '@fairgarden-private/id/lib/server/api'
import { createInteractionLogin } from '@fairgarden-private/id/lib/server/api-interactions'

export const POST = serve(createInteractionLogin)
