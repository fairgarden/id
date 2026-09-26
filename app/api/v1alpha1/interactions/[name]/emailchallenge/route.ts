import { serve } from '@fairgarden/id/lib/server/api'
import { createInteractionEmailChallenge } from '@fairgarden/id/lib/server/api-interactions'

export const POST = serve(createInteractionEmailChallenge)
