import { serve } from '@fairgarden/id/lib/server/api'
import { createPasskeyChallenge } from '@fairgarden/id/lib/server/api-account'

export const POST = serve(createPasskeyChallenge)
