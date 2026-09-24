import { serve } from '@fairgarden-private/id/lib/server/api'
import { createPasskey, listPasskeys } from '@fairgarden-private/id/lib/server/api-account'

export const GET = serve(listPasskeys)
export const POST = serve(createPasskey)
