import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_VERSION } from '@fairgarden-private/id/lib/api/group'
import { apiResources, openApiDocument, ROUTES } from '@fairgarden-private/id/lib/server/api'
import { ROOT } from './helpers/database'

/** `interactions/{name}/login` -> app/api/<version>/interactions/[name]/login/route.ts */
const routeFile = (routePath: string) =>
  path.join(ROOT, 'app', 'api', API_VERSION, ...routePath.replace('{name}', '[name]').split('/'), 'route.ts')

describe('the REST API', () => {
  it('has a route file for every operation, exporting its method', async () => {
    for (const route of ROUTES) {
      const file = routeFile(route.path)
      expect(existsSync(file), `${route.method} ${route.path} needs ${path.relative(ROOT, file)}`).toBe(true)
      const exported = (await import(file)) as Record<string, unknown>
      expect(typeof exported[route.method], `${path.relative(ROOT, file)} exports ${route.method}`).toBe('function')
    }
  })

  it('lists every resource in discovery, with its verbs', async () => {
    const list = await apiResources().json()
    expect(list).toMatchObject({ kind: 'APIResourceList', groupVersion: `id.fairgarden.org/${API_VERSION}` })
    const interactions = list.resources.find((resource: { name: string }) => resource.name === 'interactions')
    expect(interactions).toMatchObject({ kind: 'Interaction', verbs: ['get', 'delete'] })
  })

  it('describes every operation in an OpenAPI document whose references all resolve', async () => {
    const document = await openApiDocument().json()
    expect(document.openapi).toBe('3.1.0')
    const operations = Object.values(document.paths as Record<string, Record<string, unknown>>).flatMap(Object.values)
    expect(operations).toHaveLength(ROUTES.length)

    const refs = [...JSON.stringify(document).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((match) => match[1])
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) expect(document.components.schemas, `#/components/schemas/${ref}`).toHaveProperty(ref)
    expect(document.webhooks.claimsReview.post.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/ClaimsReview',
    })
  })
})
