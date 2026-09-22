import type { z } from 'zod'

export function encodeEvent(event: object) {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
}

export async function* readEventStream<T>(body: ReadableStream<Uint8Array>, schema: z.ZodType<T>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      if (buffer.length > 3_000_000) throw new Error('The streamed response is too large.')
      let boundary = /\r?\n\r?\n/.exec(buffer)
      while (boundary) {
        const frame = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n')
        if (data) yield schema.parse(JSON.parse(data))
        boundary = /\r?\n\r?\n/.exec(buffer)
      }
      if (done) {
        if (buffer.trim())
          throw new Error('The response stream ended before an event was complete.')
        return
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
