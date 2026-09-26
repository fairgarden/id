import { serve } from '@fairgarden/id/lib/server/api'
import { createInteractionConsent } from '@fairgarden/id/lib/server/api-interactions'

export const POST = serve(createInteractionConsent)
