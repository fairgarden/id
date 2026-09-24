import { serve } from '@fairgarden-private/id/lib/server/api'
import { deleteInteraction, readInteraction } from '@fairgarden-private/id/lib/server/api-interactions'

export const GET = serve(readInteraction)
export const DELETE = serve(deleteInteraction)
