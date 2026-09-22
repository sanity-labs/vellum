import { afterEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { runPortableText } from './engine/document/portable-text'
import { createVellum } from './sdk'
import {
  documentRunResponse,
  portableTextRequest,
  portableTextUpdateRequest,
} from './shared/contracts'
import { encodeEvent } from './shared/event-stream'
import { documentVersion } from './shared/json'

const schema = {
  types: {
    entry: {
      extends: 'document',
      fields: [
        {
          name: 'title',
          typeDef: { extends: 'string', validation: [{ rules: [{ type: 'required' }] }] },
        },
        {
          name: 'body',
          typeDef: { extends: 'array', of: [{ name: 'block', typeDef: { extends: 'block' } }] },
        },
      ],
    },
  },
}
afterEach(() => vi.unstubAllGlobals())

test('document versions ignore object property order but detect reordered arrays and changed values', async () => {
  const version = await documentVersion({
    _type: 'entry',
    body: [
      { _key: 'a', text: 'One' },
      { _key: 'b', text: 'Two' },
    ],
  })
  expect(
    await documentVersion({
      body: [
        { text: 'One', _key: 'a' },
        { text: 'Two', _key: 'b' },
      ],
      _type: 'entry',
    }),
  ).toBe(version)
  expect(
    await documentVersion({
      _type: 'entry',
      body: [
        { _key: 'b', text: 'Two' },
        { _key: 'a', text: 'One' },
      ],
    }),
  ).not.toBe(version)
  expect(
    await documentVersion({
      _type: 'entry',
      body: [
        { _key: 'a', text: 'Changed' },
        { _key: 'b', text: 'Two' },
      ],
    }),
  ).not.toBe(version)
})

test('maps and updates one field through the SDK without inference, unrelated required-field errors, or lost keys', async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Unexpected classifier request')
  })
  const client = createVellum({
    endpoint: '/api/',
    schema,
    fetch: async (url, init) => {
      expect(url).toBe('/api/portable-text')
      const input = z
        .union([portableTextUpdateRequest, portableTextRequest])
        .parse(JSON.parse(String(init.body)))
      return Response.json(
        await runPortableText(input, init.signal ?? new AbortController().signal),
      )
    },
  })
  const source = 'A typoo.\n\nKeep this paragraph.'
  const converted = await client.convertPortableText({ source, target: 'entry.body' })
  expect(converted.value).toHaveLength(2)
  expect(converted.errors).toEqual([])
  expect(converted.trace.every((step) => step.engine === 'Code')).toBe(true)

  const updated = await client.updatePortableText({
    source: source.replace('typoo', 'typo'),
    target: converted.target,
    value: converted.value,
    sourceBaseline: converted.sourceBaseline,
  })
  expect(updated.value.map((block) => block._key)).toEqual(
    converted.value.map((block) => block._key),
  )
  expect(updated.value[1]).toEqual(converted.value[1])
  expect(JSON.stringify(updated.value[0])).toContain('A typo.')
  expect(updated.sourceBaseline.source).toBe('A typo.\n\nKeep this paragraph.')
  expect(updated.trace.every((step) => step.engine === 'Code')).toBe(true)

  await expect(
    client.updatePortableText({
      source: 'A typo.\n\nKeep this paragraph.',
      target: converted.target,
      value: updated.value,
      sourceBaseline: converted.sourceBaseline,
    }),
  ).rejects.toThrow('different document')
  await expect(client.convertPortableText({ source, target: 'entry.title' })).rejects.toThrow(
    'rich-text field',
  )
})

test('isolates client configurations and forwards cancellation without making an aborted request', async () => {
  const requests: { url: string; schema: string; signal: AbortSignal | null | undefined }[] = []
  const send = async (url: string, init: RequestInit) => {
    requests.push({ url, schema: JSON.parse(String(init.body)).schema, signal: init.signal })
    return Response.json({ error: 'Stop here.' }, { status: 400 })
  }
  const first = createVellum({ endpoint: '/first', schema: '{}', fetch: send })
  const second = createVellum({ endpoint: '/second', schema, fetch: send })
  const controller = new AbortController()
  await expect(
    first.convertPortableText(
      { source: 'Text', target: 'entry.body' },
      { signal: controller.signal },
    ),
  ).rejects.toThrow('Stop here.')
  await expect(
    second.convertPortableText({ source: 'Text', target: 'entry.body' }),
  ).rejects.toThrow('Stop here.')
  expect(requests.map(({ url, schema }) => ({ url, schema }))).toEqual([
    { url: '/first/portable-text', schema: '{}' },
    { url: '/second/portable-text', schema: JSON.stringify(schema) },
  ])
  expect(requests[0].signal).toBe(controller.signal)
  controller.abort()
  await expect(
    first.convertPortableText(
      { source: 'Text', target: 'entry.body' },
      { signal: controller.signal },
    ),
  ).rejects.toThrow()
  expect(requests).toHaveLength(2)
})

test('streams document progress and supplies the real document version for updates', async () => {
  const doc = { _type: 'entry', title: 'A title' }
  const version = await documentVersion(doc)
  const result = documentRunResponse.parse({
    status: 'mapped',
    document: doc,
    documentType: null,
    classification: null,
    sourceBaseline: { source: '# A title', version },
    warnings: [],
    errors: [],
    trace: [],
    elapsedMs: 1,
  })
  const paths: string[] = []
  const client = createVellum({
    endpoint: '/api',
    fetch: async (url, init) => {
      paths.push(url)
      const body = JSON.parse(String(init.body))
      if (url.endsWith('document-patch')) {
        expect(body.baseVersion).toBe(version)
        expect(body.sourceBaseline).toEqual(result.sourceBaseline)
        expect(body.document).toEqual(doc)
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encodeEvent({ type: 'progress', message: 'Mapping fields…' }))
            controller.enqueue(encodeEvent({ type: 'complete', result }))
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    },
  })
  const progress: string[] = []
  const converted = await client.convertDocument(
    { source: '# A title', documentType: 'entry' },
    {
      onProgress(event) {
        if (event.type === 'progress') progress.push(event.message)
      },
    },
  )
  expect(progress).toEqual(['Mapping fields…'])
  expect(converted).toEqual(result)
  await client.updateDocument({ source: '# Changed title', previous: converted })
  expect(paths).toEqual(['/api/document-run', '/api/document-patch'])
})

test('rejects malformed responses and incomplete streams', async () => {
  const client = createVellum({ endpoint: '/api', fetch: async () => Response.json({ value: [] }) })
  await expect(
    client.convertPortableText({ source: 'Text', target: 'entry.body' }),
  ).rejects.toThrow()
  const incomplete = createVellum({
    endpoint: '/api',
    fetch: async () =>
      new Response(encodeEvent({ type: 'progress', message: 'Reading…' }), {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
  })
  await expect(incomplete.convertDocument({ source: 'Text' })).rejects.toThrow('stream ended')
})
