import { afterEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { documentRunRequest, documentRunResponse, textBlock } from '../../shared/contracts'
import type { JsonObject } from '../../shared/json'
import { fakeJev } from '../jev/fake'
import { createSchema, defaultSchema, loadSchema } from '../schema/registry'
import { validateMappedDocument } from '../schema/validation'
import { materializeDocument } from './materialize'
import { buildDocument, runDocument } from './pipeline'

const descriptor = {
  types: {
    landing: {
      extends: 'document',
      title: 'Landing page',
      fields: [
        {
          name: 'title',
          typeDef: { extends: 'string', validation: [{ rules: [{ type: 'required' }] }] },
        },
        { name: 'slug', typeDef: { extends: 'slug' } },
        {
          name: 'sections',
          typeDef: {
            extends: 'array',
            of: [
              { name: 'hero', typeDef: { extends: 'hero' } },
              { name: 'faq', typeDef: { extends: 'faq' } },
            ],
          },
        },
      ],
    },
    article: {
      extends: 'document',
      fields: [{ name: 'headline', typeDef: { extends: 'string' } }],
    },
    hero: {
      extends: 'object',
      fields: [
        { name: 'heading', typeDef: { extends: 'string' } },
        {
          name: 'alignment',
          typeDef: { extends: 'string', options: { list: ['left', 'center'] } },
        },
        {
          name: 'content',
          typeDef: { extends: 'array', of: [{ name: 'block', typeDef: { extends: 'block' } }] },
        },
        {
          name: 'cta',
          typeDef: {
            extends: 'object',
            fields: [
              { name: 'label', typeDef: { extends: 'string' } },
              { name: 'url', typeDef: { extends: 'url' } },
            ],
          },
        },
        {
          name: 'customer',
          typeDef: {
            extends: 'reference',
            to: [{ name: 'article' }],
            validation: [{ rules: [{ type: 'required' }] }],
          },
        },
      ],
    },
    faq: {
      extends: 'object',
      fields: [
        {
          name: 'items',
          typeDef: {
            extends: 'array',
            of: [
              {
                name: 'question',
                typeDef: {
                  extends: 'object',
                  fields: [
                    { name: 'question', typeDef: { extends: 'string' } },
                    {
                      name: 'answer',
                      typeDef: { extends: 'text', validation: [{ rules: [{ type: 'required' }] }] },
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
}
const mappedDocument: JsonObject = {
  _type: 'landing',
  title: 'Atlas',
  slug: 'atlas',
  sections: [
    {
      _type: 'hero',
      heading: 'Work together',
      alignment: 'center',
      content: 'Keep **context** close.',
      cta: { label: 'See Atlas', url: 'https://example.com/atlas' },
    },
    {
      _type: 'faq',
      items: [
        { _type: 'question', question: 'Can I export?', answer: 'Yes, as JSON.' },
        { _type: 'question', question: 'On premises?', answer: '' },
      ],
    },
  ],
}
const signal = () => new AbortController().signal
const input = (extra: object = {}) =>
  documentRunRequest.parse({
    source: '# Atlas',
    schema: JSON.stringify(descriptor),
    ...extra,
  })
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('rejects retired generation options at the request boundary', () => {
  for (const extra of [
    { model: { provider: 'other', id: 'any-model' } },
    { mappingMode: 'standard' },
    { instruction: 'Rewrite the source' },
  ]) {
    expect(documentRunRequest.safeParse({ source: 'Preserve this.', ...extra }).success).toBe(false)
  }
})
function jev(choice: string, confidence: number) {
  return Response.json({
    model: 'jev-test',
    usage: { input_tokens: 100, output_tokens: 2 },
    answers: { documentType: { choice, confidence, probabilities: { [choice]: confidence } } },
  })
}

test('builds nested sections and validates missing facts without generating them', async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('No external request expected')
  })
  const registry = createSchema(descriptor)
  const result = await buildDocument(mappedDocument, registry, 'landing', 0.8, signal())
  const validation = await validateMappedDocument(result.document, registry, signal())
  expect(result.document).toMatchObject({
    _type: 'landing',
    slug: { _type: 'slug', current: 'atlas' },
    sections: [
      { _type: 'hero', _key: expect.any(String), cta: { url: 'https://example.com/atlas' } },
      { _type: 'faq', items: [{ _key: expect.any(String) }, { _key: expect.any(String) }] },
    ],
  })
  const parsed = z
    .object({ sections: z.array(z.object({ content: z.array(textBlock).optional() })) })
    .parse(result.document)
  expect(parsed.sections[0].content?.[0].children.map((span) => span.text).join('')).toBe(
    'Keep context close.',
  )
  expect(validation.markers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'value.required',
        path: ['sections', expect.objectContaining({ _key: expect.any(String) }), 'customer'],
      }),
      expect.objectContaining({
        code: 'value.required',
        path: [
          'sections',
          expect.objectContaining({ _key: expect.any(String) }),
          'items',
          expect.objectContaining({ _key: expect.any(String) }),
          'answer',
        ],
      }),
    ]),
  )
})

test.each([
  ['landing', 0.4],
  ['__no_match__', 0.99],
])('stops before mapping for an uncertain or unmatched type (%s)', async (choice, confidence) => {
  vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
  let calls = 0
  vi.stubGlobal('fetch', async (url: string) => {
    expect(url).toContain('typesafe')
    calls++
    return jev(choice, confidence)
  })
  const result = await runDocument(input(), signal())
  expect(result.status).toBe('needs-type')
  expect(result.document).toBeNull()
  expect(calls).toBe(1)
})

test('returns ranked schema alternatives and converts a chosen alternative without reclassifying', async () => {
  const requests = fakeJev({
    documentType: {
      choice: 'article',
      confidence: 0.4,
      probabilities: { article: 0.4, landing: 0.3, __no_match__: 0.2, unknown: 0.1 },
    },
    assign: { B000: ['title'] },
  })
  const result = documentRunResponse.parse(await runDocument(input(), signal()))
  expect(result.status).toBe('needs-type')
  expect(result.documentType?.name).toBe('article')
  expect(result.classification?.alternatives).toEqual([
    { name: 'landing', title: 'Landing page', confidence: 0.3 },
  ])
  const alternative = result.classification?.alternatives[0]
  expect(alternative).toBeDefined()
  const converted = await runDocument(input({ documentType: alternative?.name }), signal())
  expect(converted.status).toBe('mapped')
  expect(converted.document).toMatchObject({ _type: 'landing', title: 'Atlas' })
  expect(requests.filter((request) => 'documentType' in request.questions)).toHaveLength(1)
})

test('custom registries stay isolated and reject malformed or cyclic descriptors', () => {
  const one = createSchema(descriptor)
  const two = createSchema({
    types: {
      landing: {
        extends: 'document',
        fields: [{ name: 'different', typeDef: { extends: 'number' } }],
      },
    },
  })
  expect(one.getDocument('landing').fields[0].name).toBe('title')
  expect(two.getDocument('landing').fields[0].name).toBe('different')
  expect(defaultSchema.getDocument('landingPage').fields[0].name).toBe('title')
  expect(() => loadSchema('{broken')).toThrow('not valid JSON')
  expect(() => loadSchema('[]')).toThrow('schema-descriptor JSON')
  expect(() => createSchema({ types: { a: { extends: 'b' }, b: { extends: 'a' } } })).toThrow(
    'Cyclic',
  )
})

test('rejects unknown fields, array members and invalid enums, and never keeps invented references', () => {
  const registry = createSchema(descriptor)
  const result = materializeDocument(
    {
      _type: 'landing',
      title: 'Atlas',
      extra: 'invented',
      sections: [
        {
          _type: 'hero',
          alignment: 'diagonal',
          customer: { _type: 'reference', _ref: 'invented' },
        },
        { _type: 'invented' },
      ],
    },
    registry,
    'landing',
  )
  expect(result.errors.join(' ')).toContain('extra')
  expect(result.errors.join(' ')).toContain('unknown section')
  expect(JSON.stringify(result.document)).not.toContain('invented')
  expect(result.warnings.join(' ')).toContain('needs an existing reference')
})

test('materializes mixed nested page-builder sections and rejects mistyped scalars', () => {
  expect(
    materializeDocument({ _type: 'landingPage', title: 42 }, defaultSchema, 'landingPage').errors,
  ).toEqual(['landingPage.title: expected a string.'])
  const result = materializeDocument(
    {
      _type: 'landingPage',
      title: 'Atlas',
      slug: 'atlas',
      content: [
        { _type: 'heroPageBlock', title: 'Atlas for teams', description: 'Keep context close.' },
        {
          _type: 'faqPageBlock',
          title: 'Questions',
          questions: [
            { _type: 'faqQuestion', question: 'Can I export?', answer: 'Yes, as **JSON**.' },
          ],
        },
        { _type: 'callToActionPageBlock', title: 'Get started' },
      ],
    },
    defaultSchema,
    'landingPage',
  )
  expect(result.richTextCount).toBeGreaterThanOrEqual(2)
  expect(result.document).toMatchObject({
    content: [
      { _type: 'heroPageBlock', title: [{ _type: 'block' }] },
      { _type: 'faqPageBlock', questions: [{ _key: expect.any(String) }] },
      { _type: 'callToActionPageBlock', title: [{ _type: 'block' }] },
    ],
  })
})
