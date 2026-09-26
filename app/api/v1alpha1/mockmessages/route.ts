import { serve } from '@fairgarden/id/lib/server/api'
import { deleteMockMessages, listMockMessages } from '@fairgarden/id/lib/server/api-account'

export const GET = serve(listMockMessages)
export const DELETE = serve(deleteMockMessages)
