import { serve } from '@fairgarden/id/lib/server/api'
import { patchInteractionAccount, readInteractionAccount } from '@fairgarden/id/lib/server/api-interactions'

export const GET = serve(readInteractionAccount)
export const PATCH = serve(patchInteractionAccount)
