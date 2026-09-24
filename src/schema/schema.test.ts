import { afterEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { runDocument } from '../engine/document/pipeline'
import { fakeJev } from '../engine/jev/fake'
import { createSchema } from '../engine/schema/registry'
import { compileValidationSchema, validateMappedDocument } from '../engine/schema/validation'
import { compileSchemaCode } from './code'
import { descriptorFromTypes, type TypeDefinition } from './descriptor'
import { isJsonSchema, typesFromJsonSchema } from './json-schema'
import { toPlainJson } from './plain'
import { schemaFormats, starterSchema, starters } from './starters'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const cases = starters.flatMap((starter) =>
  schemaFormats.map((format) => ({ starter, format: format.value, title: starter.title })),
)

test.each(cases)(
  'the $title starter as $format compiles into a descriptor',
  async ({ starter, format }) => {
    const schema = starterSchema(starter, format)
    const registry = createSchema(await descriptorFromTypes(schema.types))
    expect(registry.documents.map((document) => document.name)).toEqual([schema.documentType])
    expect(schema.unmapped).toEqual([])
    expect(() => compileValidationSchema(registry)).not.toThrow()
  },
)

test.each(['sanity', 'zod'] as const)(
  'the landing page starter as %s nests buttons inside hero sections',
  async (format) => {
    const starter = starters.find((item) => item.id === 'landing-page')
    if (!starter) throw new Error('Missing landing page starter')
    const schema = starterSchema(starter, format)
    const registry = createSchema(await descriptorFromTypes(schema.types))
    const sections = registry.field(registry.getDocument(schema.documentType).schema, 'sections')
    const hero = registry.members(sections ?? { extends: 'array' }).find((m) => m.name === 'hero')
    const actions = registry.field(hero?.typeDef ?? { extends: 'object' }, 'actions')
    expect(registry.members(actions ?? { extends: 'array' }).map((m) => m.name)).toEqual(['button'])
  },
)

test('descriptorFromTypes reports schema errors instead of compiling them', async () => {
  await expect(
    descriptorFromTypes([
      { name: 'broken', type: 'document', fields: [{ name: 'x', type: 'nope' }] },
    ]),
  ).rejects.toThrow(/schema has errors/)
})

const Job = z
  .object({
    title: z.string().min(1).max(120),
    location: z.string().optional(),
    workplace: z.enum(['Remote', 'Hybrid', 'On-site']),
    salary: z.number().int().min(0).nullable(),
    applyUrl: z.url(),
    closesAt: z.iso.datetime(),
    description: z.string().meta({ format: 'markdown' }),
    tags: z.array(z.string()),
    perks: z.array(z.object({ title: z.string(), detail: z.string().optional() })),
  })
  .meta({ title: 'Job posting' })

test('a Zod schema converts through JSON Schema into a document type', async () => {
  const { types, documentType, unmapped } = typesFromJsonSchema(z.toJSONSchema(Job))
  expect(documentType).toBe('jobPosting')
  expect(unmapped).toEqual(['tags (array of string values)'])
  const registry = createSchema(await descriptorFromTypes(types))
  const fields = registry.getDocument('jobPosting').fields
  expect(Object.fromEntries(fields.map((field) => [field.name, field.type]))).toEqual({
    title: 'string',
    location: 'string',
    workplace: 'string',
    salary: 'number',
    applyUrl: 'url',
    closesAt: 'datetime',
    description: 'array',
    tags: 'array',
    perks: 'array',
  })
  expect(
    registry.choices(registry.field(registry.getDocument('jobPosting').schema, 'workplace')),
  ).toEqual(['Remote', 'Hybrid', 'On-site'])
})

test('required JSON Schema properties become required Sanity fields', async () => {
  const { types } = typesFromJsonSchema(z.toJSONSchema(Job))
  const registry = createSchema(await descriptorFromTypes(types))
  const result = await validateMappedDocument(
    { _type: 'jobPosting', location: 'Oslo' },
    registry,
    new AbortController().signal,
  )
  expect(result.errors).toContain('title: Required')
  expect(result.errors.some((error) => error.startsWith('location'))).toBe(false)
})

test('anyOf array items become named members, keyed by their const type', () => {
  const { types } = typesFromJsonSchema({
    title: 'Page',
    type: 'object',
    properties: {
      sections: {
        type: 'array',
        items: {
          anyOf: [
            { $ref: '#/$defs/hero' },
            {
              type: 'object',
              properties: { type: { const: 'faq' }, question: { type: 'string' } },
            },
          ],
        },
      },
    },
    $defs: { hero: { title: 'Hero', type: 'object', properties: { heading: { type: 'string' } } } },
  })
  const sections = (types[0] as { fields: { name: string; of?: { name: string }[] }[] }).fields[0]
  expect(sections.of?.map((member) => member.name)).toEqual(['hero', 'faq'])
})

test('isJsonSchema tells JSON Schema apart from a schema descriptor', () => {
  expect(isJsonSchema(z.toJSONSchema(Job))).toBe(true)
  expect(isJsonSchema({ types: { post: { extends: 'document' } } })).toBe(false)
})

test('toPlainJson drops Sanity bookkeeping and renders rich text as Markdown', () => {
  expect(
    toPlainJson({
      _type: 'jobPosting',
      title: 'Engineer',
      description: [
        {
          _type: 'block',
          _key: 'a',
          style: 'normal',
          markDefs: [],
          children: [{ _type: 'span', _key: 'b', text: 'Hello', marks: ['strong'] }],
        },
      ],
      perks: [{ _type: 'perk', _key: 'c', title: 'Books' }],
      slug: { _type: 'slug', current: 'engineer' },
    }),
  ).toEqual({
    title: 'Engineer',
    description: '**Hello**',
    perks: [{ title: 'Books' }],
    slug: 'engineer',
  })
})

test('a starter maps through the pipeline and leaves an absent required value empty', async () => {
  const starter = starters.find((item) => item.id === 'product')
  if (!starter) throw new Error('Missing product starter')
  fakeJev({ assign: { B000: ['name'] } })
  const result = await runDocument(
    {
      source: starter.source,
      schema: JSON.stringify(await descriptorFromTypes(starterSchema(starter, 'sanity').types)),
      documentType: 'product',
      threshold: 0.7,
    },
    new AbortController().signal,
  )
  expect(result.document).toMatchObject({ _type: 'product', name: 'Northwind Trail Pack 28' })
  expect(result.document).not.toHaveProperty('price')
  expect(result.errors).toContain('price: Required')
})

test('toPlainJson restores the discriminator a Zod union declares, so the output parses', () => {
  const starter = starters.find((item) => item.id === 'landing-page')
  if (!starter) throw new Error('Missing landing page starter')
  const { jsonSchema, zod } = starterSchema(starter, 'zod')
  const plain = toPlainJson(
    {
      _type: 'landingPage',
      title: 'Atlas',
      sections: [
        { _type: 'hero', _key: 'a', heading: 'Plan together', actions: [] },
        {
          _type: 'faq',
          _key: 'b',
          questions: [{ _type: 'question', _key: 'c', question: 'Q?', answer: 'A.' }],
        },
      ],
    },
    jsonSchema,
  )
  expect(plain).toEqual({
    title: 'Atlas',
    sections: [
      { type: 'hero', heading: 'Plan together', actions: [] },
      { type: 'faq', questions: [{ question: 'Q?', answer: 'A.' }] },
    ],
  })
  expect(zod?.safeParse(plain).success).toBe(true)
})

const sanityModules = import.meta.glob<Record<string, unknown>>('./starters/sanity/*.ts', {
  eager: true,
})
const zodModules = import.meta.glob<Record<string, unknown>>('./starters/zod/*.ts', { eager: true })

test.each(starters)(
  'the $title editor code compiles to the same schema as its module',
  async (starter) => {
    const [sanityExport] = Object.values(sanityModules[`./starters/sanity/${starter.id}.ts`])
    expect(await descriptorFromTypes(starterSchema(starter, 'sanity').types)).toEqual(
      await descriptorFromTypes([sanityExport as TypeDefinition]),
    )
    const [zodExport] = Object.values(zodModules[`./starters/zod/${starter.id}.ts`])
    expect(starterSchema(starter, 'zod').jsonSchema).toEqual(z.toJSONSchema(zodExport as z.ZodType))
  },
)

test('edited Zod code compiles, and its schema checks the output', () => {
  const compiled = compileSchemaCode(
    'zod',
    "import { z } from 'zod'\n\nexport const Talk = z.object({ title: z.string(), minutes: z.number() }).meta({ title: 'Talk' })\n",
  )
  expect(compiled.documentType).toBe('talk')
  expect(compiled.zod?.safeParse({ title: 'Hi' }).success).toBe(false)
})

test('TypeScript annotations in editor code explain what to change', () => {
  expect(() =>
    compileSchemaCode(
      'sanity',
      "export const post = defineType({ name: 'post', type: 'document', fields: [{ name: 't', type: 'string', validation: (rule: Rule) => rule }] })",
    ),
  ).toThrow(/leave out TypeScript annotations/)
})

test('editor code without a document type says what to export', () => {
  expect(() => compileSchemaCode('sanity', 'export const x = 1')).toThrow(/Export a document type/)
  expect(() => compileSchemaCode('zod', 'export const x = 1')).toThrow(/Export a Zod object schema/)
})
