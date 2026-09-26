import { serve } from '@fairgarden/id/lib/server/api'
import { listPolicyDecisions } from '@fairgarden/id/lib/server/api-account'

export const GET = serve(listPolicyDecisions)
