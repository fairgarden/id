import { serve } from '@fairgarden/id/lib/server/api'
import { createInteractionLogin } from '@fairgarden/id/lib/server/api-interactions'

export const POST = serve(createInteractionLogin)
