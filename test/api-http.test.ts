import { describe, expect, it } from 'vitest'
import * as z from 'zod'
import { assertSameOrigin, mergePatch, parse, readBody } from '@fairgarden-private/id/lib/server/api-http'
import { ApiError } from '@fairgarden-private/id/lib/server/errors'

describe('mergePatch', () => {
  // The examples from RFC 7386, appendix A.
  it.each([
    [{ a: 'b' }, { a: 'c' }, { a: 'c' }],
    [{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }],
    [{ a: 'b' }, { a: null }, {}],
    [{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }],
    [{ a: ['b'] }, { a: 'c' }, { a: 'c' }],
    [{ a: 'c' }, { a: ['b'] }, { a: ['b'] }],
    [{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }],
    [{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
    [['a', 'b'], ['c', 'd'], ['c', 'd']],
    [{ a: 'b' }, ['c'], ['c']],
    [{ a: 'foo' }, null, null],
    [{ a: 'foo' }, 'bar', 'bar'],
    [{ e: null }, { a: 1 }, { e: null, a: 1 }],
    [[1, 2], { a: 'b', c: null }, { a: 'b' }],
    [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
  ])('%j patched with %j is %j', (target, patch, result) => {
    expect(mergePatch(target, patch)).toEqual(result)
  })
})

describe('parse', () => {
  it('names every invalid field, under a prefix', () => {
    const schema = z.object({ name: z.string().min(1), age: z.number() })
    try {
      parse(schema, { name: '', age: 'x' }, 'spec')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      const status = (error as ApiError).toStatus()
      expect(status).toMatchObject({ kind: 'Status', status: 'Failure', code: 422, reason: 'Invalid' })
      expect(status.details?.causes?.map((cause) => cause.field)).toEqual(['spec.name', 'spec.age'])
    }
  })
})

describe('readBody', () => {
  const request = (body: string, type: string) =>
    new Request('http://id.test/', { method: 'POST', body, headers: { 'content-type': type } })

  it('reads JSON and merge patches', async () => {
    expect(await readBody(request('{"a":1}', 'application/json; charset=utf-8'))).toEqual({ a: 1 })
    expect(await readBody(request('{"a":null}', 'application/merge-patch+json'))).toEqual({ a: null })
  })

  it('refuses anything else', async () => {
    await expect(readBody(request('a=1', 'application/x-www-form-urlencoded'))).rejects.toMatchObject({ code: 415 })
    await expect(readBody(request('{', 'application/json'))).rejects.toMatchObject({ code: 400 })
  })
})

describe('assertSameOrigin', () => {
  const from = (origin?: string) =>
    new Request('http://localhost:3010/api/v1alpha1/accounts/me', {
      method: 'PATCH',
      headers: { host: 'localhost:3010', ...(origin ? { origin } : {}) },
    })

  it('lets through the same origin, and requests without one', () => {
    expect(() => assertSameOrigin(from('http://localhost:3010'))).not.toThrow()
    expect(() => assertSameOrigin(from())).not.toThrow()
  })

  it('refuses another site', () => {
    expect(() => assertSameOrigin(from('https://evil.example'))).toThrow(/Cross-site/)
  })
})
