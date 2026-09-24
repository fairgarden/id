import { serve } from '@fairgarden-private/id/lib/server/api'
import { createPasskeyChallenge } from '@fairgarden-private/id/lib/server/api-account'

export const POST = serve(createPasskeyChallenge)
