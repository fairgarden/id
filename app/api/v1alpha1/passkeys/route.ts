import { serve } from '@fairgarden/id/lib/server/api'
import { createPasskey, listPasskeys } from '@fairgarden/id/lib/server/api-account'

export const GET = serve(listPasskeys)
export const POST = serve(createPasskey)
