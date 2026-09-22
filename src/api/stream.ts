import { type DocumentPatchRequest, runDocumentPatch } from '../engine/document/patch'
import { runDocument } from '../engine/document/pipeline'
import type { DocumentRunEvent, DocumentRunRequest } from '../shared/contracts'
import { encodeEvent } from '../shared/event-stream'

export function streamDocument(
  input: DocumentRunRequest | DocumentPatchRequest,
  signal: AbortSignal,
) {
  const abort = new AbortController()
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      function emit(event: DocumentRunEvent) {
        if (!cancelled) controller.enqueue(encodeEvent(event))
      }
      try {
        emit({ type: 'progress', message: 'Reading the schema…' })
        const result = await ('document' in input
          ? runDocumentPatch(input, AbortSignal.any([signal, abort.signal]), emit)
          : runDocument(input, AbortSignal.any([signal, abort.signal]), emit))
        emit({ type: 'complete', result })
      } catch (error) {
        emit({
          type: 'error',
          message: error instanceof Error ? error.message : 'Document mapping failed.',
        })
      } finally {
        if (!cancelled) controller.close()
      }
    },
    cancel() {
      cancelled = true
      abort.abort()
    },
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
