import { serve } from '@fairgarden/id/lib/server/api'
import { createInteractionPasskey } from '@fairgarden/id/lib/server/api-interactions'

export const POST = serve(createInteractionPasskey)
