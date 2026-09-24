import { serve } from '@fairgarden-private/id/lib/server/api'
import { patchAccount, readAccount } from '@fairgarden-private/id/lib/server/api-account'

export const GET = serve(readAccount)
export const PATCH = serve(patchAccount)
