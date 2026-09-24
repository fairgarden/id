import { serve } from '@fairgarden-private/id/lib/server/api'
import { createInteractionPasskeyChallenge } from '@fairgarden-private/id/lib/server/api-interactions'

export const POST = serve(createInteractionPasskeyChallenge)
