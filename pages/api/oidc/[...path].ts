import type { NextApiRequest, NextApiResponse } from 'next'
import { handleOidc } from '@fairgarden/id/lib/server/oidc'

// oidc-provider parses bodies itself, and answers every request it is given.
export const config = { api: { bodyParser: false, externalResolver: true } }

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const path = req.query.path
  return handleOidc(req, res, Array.isArray(path) ? path : path ? [path] : [])
}
