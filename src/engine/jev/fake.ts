import { vi } from 'vitest'
import { z } from 'zod'

export type FakeJev = {
  documentType?: { choice: string; confidence?: number; probabilities?: Record<string, number> }
  singlePassages?: string[]
  assign?: Record<string, string[]>
  boundaries?: Record<string, string[]>
  members?: Record<string, string>
  joins?: string[]
}

const request = z.object({
  state: z.json(),
  questions: z.record(
    z.string(),
    z.object({
      type: z.enum(['choice', 'noul']),
      instructions: z.json(),
      criteria: z.record(z.string(), z.string().nullable()).optional(),
    }),
  ),
})

const collectionName = z.object({ collection: z.object({ name: z.string() }) })
const yes = 0.95
const no = 0.05

export function fakeJev(spec: FakeJev) {
  const requests: z.infer<typeof request>[] = []
  vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (!url.startsWith('https://api.typesafe.ai/')) throw new Error(`Unexpected request to ${url}`)
    const body = request.parse(JSON.parse(String(init.body)))
    requests.push(body)
    const answers = Object.fromEntries(
      Object.entries(body.questions).map(([id, question]) => [
        id,
        question.type === 'noul'
          ? { type: 'noul', noul: answerNoul(id, spec) }
          : answerChoice(id, Object.keys(question.criteria ?? {}), question.instructions, spec),
      ]),
    )
    return Response.json({
      model: 'jev-fake',
      usage: { input_tokens: 10, output_tokens: 1 },
      answers,
    })
  })
  return requests
}

function answerNoul(id: string, spec: FakeJev) {
  const confirm = /^confirm:([^:]+):(.+)$/.exec(id)
  if (confirm) return spec.assign?.[confirm[2]]?.includes(confirm[1]) ? yes : no
  const join = /^join:(.+)$/.exec(id)
  if (join) return spec.joins?.includes(join[1]) ? yes : no
  const arity = /^\d+:(.+)$/.exec(id)
  return arity && spec.singlePassages?.includes(arity[1]) ? yes : no
}

function answerChoice(id: string, options: string[], instructions: unknown, spec: FakeJev) {
  const boundary = /^boundary:(.+)$/.exec(id)
  if (boundary) {
    const collections = collectionName.safeParse(instructions).data?.collection.name.split(' or ')
    const opens = collections?.some((name) => spec.boundaries?.[name]?.includes(boundary[1]))
    return pick(opens ? 'sibling' : 'continues', options)
  }
  if (id === 'documentType') {
    const {
      choice,
      confidence = 0.99,
      probabilities = { [choice]: confidence },
    } = spec.documentType ?? {
      choice: '__no_match__',
    }
    return { type: 'choice', choice, confidence, probabilities }
  }
  const assign = /^assign:(.+)$/.exec(id)
  if (assign)
    return pick(
      spec.assign?.[assign[1]]?.find((field) => options.includes(field)) ?? '__none__',
      options,
    )
  const point = /^point:(.+)$/.exec(id)
  if (point) {
    const span = Object.entries(spec.assign ?? {}).find(
      ([span, fields]) => options.includes(span) && fields.includes(point[1]),
    )?.[0]
    return pick(span ?? '__none__', options)
  }
  const run = /^run:(.+)$/.exec(id)
  if (run) {
    const streams = spec.assign?.[run[1]] ?? []
    const member = spec.members?.[run[1]]
    const option = options.find((option) => {
      const [stream, kind] = option.split('.')
      return streams.includes(stream) && (!kind || !member || kind === member)
    })
    return pick(option ?? '__none__', options)
  }
  return pick(options[0], options)
}

function pick(choice: string, options: string[]) {
  if (!options.includes(choice)) return unsure(options)
  const rest = options.filter((option) => option !== choice)
  return {
    type: 'choice',
    choice,
    confidence: yes,
    probabilities: Object.fromEntries([
      [choice, yes],
      ...rest.map((option) => [option, no / Math.max(rest.length, 1)]),
    ]),
  }
}

function unsure(options: string[]) {
  const spread = 1 / options.length
  return {
    type: 'choice',
    choice: options[0],
    confidence: spread,
    probabilities: Object.fromEntries(options.map((option) => [option, spread])),
  }
}
