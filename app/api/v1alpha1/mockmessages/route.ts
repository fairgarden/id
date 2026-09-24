import { serve } from '@fairgarden-private/id/lib/server/api'
import { deleteMockMessages, listMockMessages } from '@fairgarden-private/id/lib/server/api-account'

export const GET = serve(listMockMessages)
export const DELETE = serve(deleteMockMessages)
