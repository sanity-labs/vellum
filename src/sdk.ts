import type { SchemaSummary } from '@sanity/schema-descriptor-utils'
import { z } from 'zod'
import {
  type DocumentProgress,
  type DocumentRunResult,
  documentRunEvent,
  documentRunRequest,
  documentRunResponse,
  type PortableTextResult,
  portableTextRequest,
  portableTextResponse,
  portableTextUpdateRequest,
} from './shared/contracts'
import { readEventStream } from './shared/event-stream'
import { documentVersion } from './shared/json'

export type VellumSchema = Pick<SchemaSummary, 'types'> & Partial<Omit<SchemaSummary, 'types'>>
export type VellumConfig = {
  /** URL of a Vellum API server, such as /api or https://example.com/api. */
  endpoint: string
  /** A Sanity schema descriptor. Omit to use the server's bundled schema. */
  schema?: string | VellumSchema
  fetch?: (url: string, init: RequestInit) => Promise<Response>
}
export type RequestOptions = { signal?: AbortSignal }
export type DocumentOptions = RequestOptions & { onProgress?: (event: DocumentProgress) => void }
export type DocumentResult = DocumentRunResult
export type PortableTextMapping = PortableTextResult
export type VellumClient = ReturnType<typeof createVellum>
type DocumentInput = Omit<z.input<typeof documentRunRequest>, 'schema'>
type FieldInput = Omit<z.input<typeof portableTextRequest>, 'schema'>
type FieldUpdate = Omit<z.input<typeof portableTextUpdateRequest>, 'schema'>

/** Creates a browser-safe client. Classifier credentials belong on the API server. */
export function createVellum(config: VellumConfig) {
  const endpoint = z.string().trim().min(1).parse(config.endpoint).replace(/\/+$/, '')
  const schema =
    typeof config.schema === 'string'
      ? config.schema
      : config.schema && JSON.stringify(config.schema)
  const send = config.fetch ?? globalThis.fetch

  async function request(path: string, input: object, options: RequestOptions, stream = false) {
    options.signal?.throwIfAborted()
    const response = await send(`${endpoint}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(input),
      signal: options.signal,
    })
    if (!response.ok) {
      const error = z
        .object({ error: z.string() })
        .safeParse(await response.json().catch(() => null))
      throw new Error(
        error.success ? error.data.error : `Vellum request failed (HTTP ${response.status}).`,
      )
    }
    return response
  }

  async function document(
    path: string,
    input: object,
    options: DocumentOptions,
  ): Promise<DocumentResult> {
    const response = await request(path, input, options, Boolean(options.onProgress))
    if (!response.headers.get('content-type')?.includes('text/event-stream'))
      return documentRunResponse.parse(await response.json())
    if (!response.body) throw new Error('The server returned no response stream.')
    for await (const event of readEventStream(response.body, documentRunEvent)) {
      options.signal?.throwIfAborted()
      if (event.type === 'error') throw new Error(event.message)
      if (event.type === 'complete') return event.result
      options.onProgress?.(event)
    }
    throw new Error('The stream ended before the document was checked. Please try again.')
  }

  return {
    convertDocument(input: DocumentInput, options: DocumentOptions = {}) {
      return document('document-run', documentRunRequest.parse({ ...input, schema }), options)
    },
    async updateDocument(
      input: { source: string; previous: DocumentResult; threshold?: number },
      options: DocumentOptions = {},
    ) {
      const previous = documentRunResponse.parse(input.previous)
      if (!previous.document || !previous.sourceBaseline)
        throw new Error('Convert the source before applying changes.')
      const source = documentRunRequest.shape.source.parse(input.source)
      return document(
        'document-patch',
        {
          source,
          schema,
          threshold: input.threshold,
          document: previous.document,
          sourceBaseline: previous.sourceBaseline,
          baseVersion: await documentVersion(previous.document),
        },
        options,
      )
    },
    async convertPortableText(input: FieldInput, options: RequestOptions = {}) {
      const response = await request(
        'portable-text',
        portableTextRequest.parse({ ...input, schema }),
        options,
      )
      return portableTextResponse.parse(await response.json())
    },
    async updatePortableText(input: FieldUpdate, options: RequestOptions = {}) {
      const response = await request(
        'portable-text',
        portableTextUpdateRequest.parse({ ...input, schema }),
        options,
      )
      return portableTextResponse.parse(await response.json())
    },
  }
}
