import { serve } from '@fairgarden/id/lib/server/api'
import { createInteractionPasskeyChallenge } from '@fairgarden/id/lib/server/api-interactions'

export const POST = serve(createInteractionPasskeyChallenge)
