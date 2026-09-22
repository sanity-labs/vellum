import { HTTPError } from 'nitro/h3'
import { z } from 'zod'
import { documentPatchRequest, runDocumentPatch } from '../engine/document/patch'
import { runDocument } from '../engine/document/pipeline'
import { runPortableText } from '../engine/document/portable-text'
import {
  defaultSchema,
  loadSchema,
  type SchemaRegistry,
  schemaSource,
} from '../engine/schema/registry'
import {
  documentRunRequest,
  portableTextRequest,
  portableTextUpdateRequest,
  schemaInput,
} from '../shared/contracts'
import { streamDocument } from './stream'

function catalog(registry: SchemaRegistry, custom = false) {
  return {
    targets: registry.targets.map(registry.summarize),
    documents: registry.documents,
    typeCount: registry.typeCount,
    source: custom ? '' : schemaSource,
    providers: {
      jev: Boolean(process.env.TYPESAFE_API_KEY),
    },
  }
}

export async function handleApiRequest(request: Request) {
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === '/api/catalog')
    return Response.json(catalog(defaultSchema))
  if (
    request.method === 'POST' &&
    ['/api/document-run', '/api/document-patch', '/api/portable-text', '/api/catalog'].includes(
      url.pathname,
    )
  ) {
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return Response.json({ error: 'Expected JSON.' }, { status: 415 })
    try {
      const raw: unknown = await request.json()
      if (url.pathname === '/api/portable-text') {
        const input = z.union([portableTextUpdateRequest, portableTextRequest]).parse(raw)
        return Response.json(await runPortableText(input, request.signal))
      }
      if (url.pathname === '/api/catalog') {
        const input = z.object({ schema: schemaInput }).parse(raw)
        const registry = loadSchema(input.schema)
        if (!registry.documents.length)
          throw new Error('The schema must contain at least one document type.')
        return Response.json(catalog(registry, Boolean(input.schema)))
      }
      if (url.pathname === '/api/document-patch') {
        const input = documentPatchRequest.parse(raw)
        if (request.headers.get('accept')?.includes('text/event-stream'))
          return streamDocument(input, request.signal)
        return Response.json(await runDocumentPatch(input, request.signal))
      }
      if (url.pathname === '/api/document-run') {
        const input = documentRunRequest.parse(raw)
        if (request.headers.get('accept')?.includes('text/event-stream'))
          return streamDocument(input, request.signal)
        return Response.json(await runDocument(input, request.signal))
      }
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof z.ZodError
              ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n')
              : error instanceof Error
                ? error.message
                : 'The request failed.',
        },
        { status: error instanceof HTTPError ? error.status : 400 },
      )
    }
  }
  return Response.json({ error: 'Not found.' }, { status: 404 })
}
