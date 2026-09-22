import { afterEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { fakeJev } from '../engine/jev/fake'
import { documentRunEvent, documentRunRequest } from '../shared/contracts'
import { encodeEvent, readEventStream } from '../shared/event-stream'
import { streamDocument } from './stream'

const schema = JSON.stringify({
  types: {
    page: {
      extends: 'document',
      fields: [
        { name: 'title', typeDef: { extends: 'string' } },
        {
          name: 'body',
          typeDef: { extends: 'array', of: [{ name: 'block', typeDef: { extends: 'block' } }] },
        },
      ],
    },
  },
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test.each([undefined, 'page'])(
  'streams classification progress, selected type, and the validated result (%s)',
  async (documentType) => {
    fakeJev({ documentType: { choice: 'page' }, assign: { B000: ['title'], B001: ['body'] } })
    const response = streamDocument(
      documentRunRequest.parse({ source: '# Café 🌱\n\nA **draft**.', schema, documentType }),
      new AbortController().signal,
    )
    if (!response.body) throw new Error('Expected a stream')
    const events = []
    for await (const event of readEventStream(response.body, documentRunEvent)) events.push(event)
    expect(events[0]).toMatchObject({ type: 'progress' })
    const selectedIndex = events.findIndex((event) => event.type === 'document-type')
    expect(selectedIndex).toBeGreaterThanOrEqual(0)
    expect(selectedIndex).toBeLessThan(events.findIndex((event) => event.type === 'complete'))
    expect(events[selectedIndex]).toMatchObject({
      type: 'document-type',
      documentType: { name: 'page' },
    })
    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      result: {
        document: { _type: 'page', title: 'Café 🌱', body: [{ _type: 'block' }] },
        errors: [],
      },
    })
  },
)

test('streams classification failures without returning a partial document', async () => {
  vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
  vi.stubGlobal('fetch', async () =>
    Response.json({ model: 'jev-test', usage: { input_tokens: 1, output_tokens: 0 }, answers: {} }),
  )
  const response = streamDocument(
    documentRunRequest.parse({ source: 'Text', schema, documentType: 'page' }),
    new AbortController().signal,
  )
  if (!response.body) throw new Error('Expected a stream')
  const events = []
  for await (const event of readEventStream(response.body, documentRunEvent)) events.push(event)
  expect(events.at(-1)).toMatchObject({ type: 'error' })
  expect(events.some((event) => event.type === 'complete')).toBe(false)
})

test('cancelling the browser response aborts the provider request', async () => {
  vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
  let providerSignal: AbortSignal | null | undefined
  const ready = Promise.withResolvers<void>()
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    providerSignal = init.signal
    ready.resolve()
    return new Promise<Response>((_resolve, reject) =>
      init.signal?.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }),
    )
  })
  const response = streamDocument(
    documentRunRequest.parse({
      source: 'Text',
      schema,
      documentType: 'page',
    }),
    new AbortController().signal,
  )
  await ready.promise
  await response.body?.cancel()
  expect(providerSignal?.aborted).toBe(true)
})

test('a partial frame is not silently accepted as a completed event', async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encodeEvent({ type: 'progress' }).slice(0, -1))
        controller.close()
      },
    }),
  )
  const body = response.body
  if (!body) throw new Error('Expected a stream')
  const consume = async () => {
    for await (const _event of readEventStream(body, z.json())) {
      /* Consume to EOF. */
    }
  }
  await expect(consume()).rejects.toThrow('before an event was complete')
})
