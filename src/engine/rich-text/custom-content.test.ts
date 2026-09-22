import { afterEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import logoSoupSource from '../../examples/logo-soup.md?raw'
import { textBlock } from '../../shared/contracts'
import { createSchema, defaultSchema } from '../schema/registry'
import { validateMappedDocument } from '../schema/validation'
import { planRichContent, resolveRichContent } from './custom-content'

const signal = () => new AbortController().signal
const block = { name: 'block', typeDef: { extends: 'block' } }
const custom = createSchema({
  types: {
    post: {
      extends: 'document',
      fields: [
        {
          name: 'text',
          typeDef: {
            extends: 'array',
            of: [
              block,
              {
                name: 'snippet',
                typeDef: {
                  extends: 'object',
                  fields: [
                    { name: 'code', typeDef: { extends: 'text' } },
                    { name: 'language', typeDef: { extends: 'string' } },
                  ],
                },
              },
              {
                name: 'figure',
                typeDef: {
                  extends: 'object',
                  fields: [
                    { name: 'src', typeDef: { extends: 'url' } },
                    { name: 'alt', typeDef: { extends: 'string' } },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  },
})
const requestSchema = z.object({
  questions: z.record(z.string(), z.object({ criteria: z.record(z.string(), z.string()) })),
})
function reply(ids: string[], choice: string, confidence = 0.99) {
  return Response.json({
    model: 'jev-test',
    usage: { input_tokens: 10, output_tokens: 0 },
    answers: Object.fromEntries(
      ids.map((id) => [id, { choice, confidence, probabilities: { [choice]: confidence } }]),
    ),
  })
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('maps unambiguous custom code and URL images locally, preserving values and order', async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('No network expected')
  })
  const plan = planRichContent(
    'Before.\n\n![Exact alt](https://example.com/a.png)\n\n```ts\nconst x = `unchanged`\n```\n\nAfter.',
    custom.getTarget('post.text'),
    custom,
  )
  const resolved = await resolveRichContent([plan], 0.8, signal())
  expect(resolved.batches).toBe(0)
  expect(plan.warnings).toEqual([])
  expect(plan.blocks.map((b) => b._type)).toEqual(['block', 'figure', 'snippet', 'block'])
  expect(plan.blocks[1]).toMatchObject({ src: 'https://example.com/a.png', alt: 'Exact alt' })
  expect(plan.blocks[2]).toMatchObject({ code: 'const x = `unchanged`', language: 'ts' })
})

test('batches real post choices, builds nested code, and reports unresolved assets accurately', async () => {
  vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
  let requests = 0
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    requests++
    const { questions } = requestSchema.parse(JSON.parse(String(init.body)))
    const answers = Object.fromEntries(
      Object.entries(questions).map(([id, q]) => {
        const desired = Object.entries(q.criteria).find(
          ([, text]) => text.startsWith('usageExample.example ') || text.startsWith('image ('),
        )
        expect(desired).toBeDefined()
        const choice = desired?.[0] ?? '__no_match__'
        return [id, { choice, confidence: 0.99, probabilities: { [choice]: 0.99 } }]
      }),
    )
    return Response.json({
      model: 'jev-test',
      usage: { input_tokens: 10, output_tokens: 0 },
      answers,
    })
  })
  const plan = planRichContent(
    '![Logo](https://example.com/logo.png)\n\n```js\nconst answer = 42\n```',
    defaultSchema.getTarget('post.text'),
    defaultSchema,
  )
  await resolveRichContent([plan], 0.8, signal())
  expect(requests).toBe(1)
  expect(plan.blocks[1]).toMatchObject({
    _type: 'usageExample',
    example: { _type: 'code', code: 'const answer = 42', language: 'js' },
  })
  expect(JSON.stringify(plan.blocks)).toContain('https://example.com/logo.png')
  expect(JSON.stringify(plan.blocks)).not.toContain('__pendingRichContent')
  expect(plan.warnings.join(' ')).toContain('verified asset reference')
  expect(plan.warnings.join(' ')).not.toContain('schema has no')
})

test.each(['uncertain', 'incomplete', 'unavailable'])(
  'preserves source when selection is %s',
  async (mode) => {
    vi.stubEnv('TYPESAFE_API_KEY', mode === 'unavailable' ? '' : 'test-key')
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const ids = Object.keys(requestSchema.parse(JSON.parse(String(init.body))).questions)
      return reply(mode === 'incomplete' ? [] : ids, 'c0', 0.2)
    })
    const plan = planRichContent(
      '```js\nconst original = 1\n```',
      defaultSchema.getTarget('post.text'),
      defaultSchema,
    )
    await resolveRichContent([plan], 0.8, signal())
    expect(plan.blocks[0]).toMatchObject({
      _type: 'code',
      code: 'const original = 1',
      language: 'js',
    })
    expect(plan.warnings.length).toBeGreaterThan(0)
  },
)

test('preserves every Logo Soup image and code value and validates the real post shape', async () => {
  vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
  let requests = 0
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    requests++
    const { questions } = requestSchema.parse(JSON.parse(String(init.body)))
    return Response.json({
      model: 'jev-test',
      usage: { input_tokens: 10, output_tokens: 0 },
      answers: Object.fromEntries(
        Object.entries(questions).map(([id, question]) => {
          const choice = Object.entries(question.criteria).find(
            ([, text]) => text.startsWith('usageExample.example ') || text.startsWith('image ('),
          )?.[0]
          expect(choice).toBeDefined()
          return [id, { choice, confidence: 0.99, probabilities: { [choice ?? 'none']: 0.99 } }]
        }),
      ),
    })
  })
  const plan = planRichContent(logoSoupSource, defaultSchema.getTarget('post.text'), defaultSchema)
  const resolved = await resolveRichContent([plan], 0.8, signal())
  expect(requests).toBe(1)
  expect(resolved.decisions).toBe(plan.pending.length)
  const codes = plan.pending.flatMap((n) => (n.source.kind === 'code' ? [n.source.code] : []))
  expect(
    plan.blocks
      .filter((b) => b._type === 'usageExample')
      .map((b) => z.object({ example: z.object({ code: z.string() }) }).parse(b).example.code),
  ).toEqual(codes)
  const text = plan.blocks
    .filter((b) => b._type === 'block')
    .map((b) =>
      textBlock
        .parse(b)
        .children.map((c) => c.text)
        .join(''),
    )
    .join('\n')
  for (const { source } of plan.pending)
    if (source.kind === 'image') {
      expect(text).toContain(source.src)
      expect(text).toContain(source.alt)
    }
  expect(plan.pending.filter((n) => n.source.kind === 'image')).toHaveLength(7)
  const validation = await validateMappedDocument(
    {
      _type: 'post',
      title: 'The logo soup problem',
      slug: { _type: 'slug', current: 'the-logo-soup-problem' },
      text: plan.blocks,
    },
    defaultSchema,
    signal(),
  )
  expect(validation.errors).toEqual(['authors: Required'])
})

test('runs bounded batches concurrently across fields, retaining source order', async () => {
  vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
  let active = 0,
    maxActive = 0,
    requests = 0
  const pending: { response: Response; finish: (r: Response) => void }[] = []
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    const { questions } = requestSchema.parse(JSON.parse(String(init.body)))
    const ids = Object.keys(questions)
    const choice = Object.entries(questions[ids[0]].criteria).find(([, description]) =>
      description.startsWith('usageExample.example '),
    )?.[0]
    if (!choice) throw new Error('Missing code candidate')
    const response = reply(ids, choice)
    expect(ids.length).toBeLessThanOrEqual(48)
    active++
    requests++
    maxActive = Math.max(active, maxActive)
    return new Promise<Response>((finish) => {
      pending.push({ response, finish })
      if (requests > 6) {
        active--
        finish(response)
      } else if (pending.length === 6)
        for (const item of pending.splice(0).reverse()) {
          active--
          item.finish(item.response)
        }
    })
  })
  const plans = Array.from({ length: 5 }, (_, i) =>
    planRichContent(
      Array.from({ length: 58 }, (_, j) => `~~~js\nconst n = ${i * 58 + j}\n~~~`).join('\n\n'),
      defaultSchema.getTarget('post.text'),
      defaultSchema,
    ),
  )
  const resolved = await resolveRichContent(plans, 0.8, signal())
  expect(requests).toBe(7)
  expect(maxActive).toBe(6)
  expect(resolved.decisions).toBe(290)
  const code = z.object({ example: z.object({ code: z.string() }) })
  expect(plans.flatMap((p) => p.blocks.map((b) => code.parse(b).example.code))).toEqual(
    Array.from({ length: 290 }, (_, i) => `const n = ${i}`),
  )
})

test('cancellation never returns a partially resolved document', async () => {
  const abort = new AbortController()
  abort.abort()
  const plan = planRichContent(
    '```js\nvalue\n```',
    defaultSchema.getTarget('post.text'),
    defaultSchema,
  )
  await expect(resolveRichContent([plan], 0.8, abort.signal)).rejects.toThrow()
})

test('preserves fenced code and callout tone when the target only allows text', async () => {
  const registry = createSchema({
    types: {
      post: {
        extends: 'document',
        fields: [{ name: 'text', typeDef: { extends: 'array', of: [block] } }],
      },
    },
  })
  const plan = planRichContent(
    '```js\nconst fence = "```"\n```\n\n> [!WARNING]\n> Keep this warning.',
    registry.getTarget('post.text'),
    registry,
  )
  const result = await resolveRichContent([plan], 0.8, signal())
  expect(result.batches).toBe(0)
  const text = plan.blocks
    .map((b) =>
      textBlock
        .parse(b)
        .children.map((c) => c.text)
        .join(''),
    )
    .join('\n')
  expect(text).toContain('````js\nconst fence = "```"\n````')
  expect(text).toContain('[!WARNING]')
  expect(text).toContain('Keep this warning.')
})

test.each([true, false])(
  'classifies unfamiliar code fields and preserves source when declined (%s)',
  async (accept) => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
    let requests = 0
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requests++
      const { questions } = requestSchema.parse(JSON.parse(String(init.body)))
      expect(JSON.stringify(questions)).toContain('Verbatim executable source')
      const choice = accept ? Object.keys(Object.values(questions)[0].criteria)[0] : '__no_match__'
      return reply(Object.keys(questions), choice)
    })
    const registry = createSchema({
      types: {
        notebook: {
          extends: 'document',
          fields: [
            {
              name: 'manuscript',
              typeDef: {
                extends: 'array',
                of: [
                  block,
                  {
                    name: 'listing',
                    typeDef: {
                      extends: 'object',
                      fields: [
                        {
                          name: 'payload',
                          typeDef: { extends: 'text', description: 'Verbatim executable source' },
                        },
                        {
                          name: 'dialect',
                          typeDef: {
                            extends: 'string',
                            description: 'Programming language identifier',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    })
    const plan = planRichContent(
      '```ts\nconst n = 1\n```',
      registry.getTarget('notebook.manuscript'),
      registry,
    )
    await resolveRichContent([plan], 0.8, signal())
    expect(requests).toBe(1)
    if (accept)
      expect(plan.blocks[0]).toMatchObject({
        _type: 'listing',
        payload: 'const n = 1',
        dialect: 'ts',
      })
    else {
      expect(plan.blocks[0]._type).toBe('block')
      expect(JSON.stringify(plan.blocks)).toContain('const n = 1')
      expect(plan.warnings.join(' ')).toContain('No confident')
    }
  },
)
