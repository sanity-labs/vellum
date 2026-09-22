import { mockEvent } from 'nitro/h3'
import { expect, test } from 'vitest'
import { createVellum } from '../sdk'
import { handleApiRequest } from './http'
import apiRuntime from './runtime'

test('rejects oversized bodies even without Content-Length', async () => {
  const event = mockEvent('http://localhost/api/document-run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'x'.repeat(3 * 1024 * 1024) }),
  })
  const response = await apiRuntime(event, () => handleApiRequest(event.req))
  expect(response).toBeInstanceOf(Response)
  if (!(response instanceof Response)) throw new Error('Expected an HTTP response')
  expect(response.status).toBe(413)
})

test('keeps HTTP errors and the Portable Text SDK contract at the server boundary', async () => {
  for (const [path, init, status] of [
    ['/missing', undefined, 404],
    ['/portable-text', { method: 'POST', body: '{}' }, 415],
    [
      '/portable-text',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      400,
    ],
  ] satisfies [string, RequestInit | undefined, number][]) {
    const response = await handleApiRequest(new Request(`http://localhost/api${path}`, init))
    expect(response.status).toBe(status)
    expect(await response.json()).toHaveProperty('error')
  }

  const client = createVellum({
    endpoint: 'http://localhost/api',
    fetch: (url, init) => handleApiRequest(new Request(url, init)),
  })
  const initial = await client.convertPortableText({
    source: 'A typoo.\n\nKeep this paragraph.',
    target: 'post.text',
  })
  const updated = await client.updatePortableText({
    source: 'A typo.\n\nKeep this paragraph.',
    target: initial.target,
    value: initial.value,
    sourceBaseline: initial.sourceBaseline,
  })
  expect(updated.errors).toEqual([])
  expect(updated.value.map((block) => block._key)).toEqual(initial.value.map((block) => block._key))
  expect(updated.value[1]).toEqual(initial.value[1])
  expect(JSON.stringify(updated.value[0])).toContain('A typo.')
})
