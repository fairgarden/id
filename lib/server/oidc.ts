import type { IncomingMessage, ServerResponse } from 'node:http'
import { getConfig } from './config.ts'
import { getProvider } from './provider.ts'

/**
 * Serve oidc-provider from a Pages Router API route, the one kind of Next
 * route that hands over Node's own request and response, which oidc-provider
 * — a Koa app — needs.
 *
 * `path` is the catch-all segment. It is used rather than `req.url`, which
 * still holds the path the browser asked for: `/oidc/...` on its own, but
 * `/<mount>/oidc/...` inside a monolith.
 */
export const handleOidc = async (
  req: IncomingMessage & { baseUrl?: string },
  res: ServerResponse,
  path: string[]
): Promise<void> => {
  const provider = await getProvider()
  const search = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
  req.url = `/${path.join('/')}${search}`
  // Where the endpoints are, so discovery advertises them under the mount.
  req.baseUrl = `${getConfig().mount}/oidc`
  await provider.callback()(req, res)
}
