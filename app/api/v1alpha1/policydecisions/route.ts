import { serve } from '@fairgarden-private/id/lib/server/api'
import { listPolicyDecisions } from '@fairgarden-private/id/lib/server/api-account'

export const GET = serve(listPolicyDecisions)
