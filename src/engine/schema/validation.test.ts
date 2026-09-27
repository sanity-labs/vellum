import { expect, test } from 'vitest'
import type { DocumentRunResult } from '../../shared/contracts'
import { createSchema, defaultSchema } from './registry'
import { validateMappedDocument } from './validation'

test('reports Meridian missing dependencies without filling required facts', async () => {
  const document: NonNullable<DocumentRunResult['document']> = {
    _type: 'landingPage',
    title: 'Meridian',
    slug: { _type: 'slug', current: 'meridian' },
    content: [
      { _type: 'formPageBlock', _key: 'form', title: 'Plan your first batch' },
      {
        _type: 'faqPageBlock',
        _key: 'faq',
        title: 'Frequently asked questions',
        questions: [
          { _type: 'faqQuestion', _key: 'storage', question: 'Where is the data stored?' },
        ],
      },
    ],
  }
  const before = structuredClone(document)
  const result = await validateMappedDocument(document, defaultSchema, new AbortController().signal)
  expect(result.markers.filter((marker) => marker.level === 'error')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'value.required',
        path: ['content', { _key: 'form' }, 'form'],
      }),
      expect.objectContaining({
        code: 'value.required',
        path: ['content', { _key: 'faq' }, 'questions', { _key: 'storage' }, 'answer'],
      }),
    ]),
  )
  expect(result.errors).toHaveLength(2)
  expect(document).toEqual(before)
})

test('uses Sanity rules, severity, and keyed paths without adding system fields to the output', async () => {
  const schema = createSchema({
    types: {
      page: {
        extends: 'document',
        fields: [
          {
            name: 'title',
            typeDef: {
              extends: 'string',
              validation: [{ level: 'warning', rules: [{ type: 'minimum', value: '5' }] }],
            },
          },
          {
            name: 'items',
            typeDef: {
              extends: 'array',
              of: [
                {
                  name: 'item',
                  typeDef: {
                    extends: 'object',
                    fields: [
                      {
                        name: 'count',
                        typeDef: {
                          extends: 'number',
                          validation: [{ rules: [{ type: 'integer' }] }],
                        },
                      },
                      {
                        name: 'email',
                        typeDef: {
                          extends: 'string',
                          validation: [{ rules: [{ type: 'email' }] }],
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
  const document = {
    _type: 'page',
    title: 'Hi',
    items: [{ _type: 'item', _key: 'one', count: 1.5, email: 'bad' }],
  }
  const result = await validateMappedDocument(document, schema, new AbortController().signal)
  expect(result.status).toBe('failed')
  expect(result.markers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'string.minimum-length', level: 'warning', path: ['title'] }),
      expect.objectContaining({
        code: 'number.integer',
        level: 'error',
        path: ['items', { _key: 'one' }, 'count'],
      }),
      expect.objectContaining({ code: 'string.email', level: 'error' }),
    ]),
  )
  expect(document).not.toHaveProperty('_id')
  expect(result.errors.some((error) => error.startsWith('items[0].count: '))).toBe(true)
})

test('accepts real array choices and reports unavailable serialized custom or composed rules', async () => {
  const result = await validateMappedDocument(
    { _type: 'post', title: 'Example', categories: ['engineering'] },
    defaultSchema,
    new AbortController().signal,
  )
  expect(result.markers.some((marker) => marker.path.includes('categories'))).toBe(false)
  for (const type of ['custom', 'allOf']) {
    const registry = createSchema({
      types: {
        page: {
          extends: 'document',
          fields: [
            { name: 'title', typeDef: { extends: 'string', validation: [{ rules: [{ type }] }] } },
          ],
        },
      },
    })
    const validation = await validateMappedDocument(
      { _type: 'page', title: 'Example' },
      registry,
      new AbortController().signal,
    )
    expect(validation.status).toBe('notEvaluated')
    expect(validation.warnings.join(' ')).toContain(type)
  }
})

test('a missing required value reports Required once, not every rule on its path', async () => {
  const registry = createSchema({
    types: {
      product: {
        extends: 'document',
        fields: [
          {
            name: 'price',
            typeDef: {
              extends: 'number',
              validation: [{ rules: [{ type: 'required' }, { type: 'minimum', value: '0' }] }],
            },
          },
        ],
      },
    },
  })
  const result = await validateMappedDocument(
    { _type: 'product' },
    registry,
    new AbortController().signal,
  )
  expect(result.errors).toEqual(['price: Required'])
})
