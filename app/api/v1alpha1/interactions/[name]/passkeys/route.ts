import { serve } from '@fairgarden-private/id/lib/server/api'
import { createInteractionPasskey } from '@fairgarden-private/id/lib/server/api-interactions'

export const POST = serve(createInteractionPasskey)
