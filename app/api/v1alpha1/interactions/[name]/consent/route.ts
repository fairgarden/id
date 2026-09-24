import { serve } from '@fairgarden-private/id/lib/server/api'
import { createInteractionConsent } from '@fairgarden-private/id/lib/server/api-interactions'

export const POST = serve(createInteractionConsent)
