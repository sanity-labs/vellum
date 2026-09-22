import { describe, expect, test } from 'vitest'
import { textBlock } from '../../shared/contracts'
import { runPortableText } from '../document/portable-text'
import { createSchema, defaultSchema } from '../schema/registry'
import { convert, serialize } from './convert'

const target = defaultSchema.getTarget('article.content')

describe('conversion against the supplied descriptor', () => {
  test('preserves text and maps links, callouts and nested code to the actual schema', () => {
    const { blocks } = convert(
      '## Start\n\nA **bold** [link](https://sanity.io).\n\n> [!TIP]\n> Keep a backup.\n\n~~~ts\nconst count = 2\n~~~',
      target,
    )
    const paragraph = textBlock.parse(blocks[1])
    expect(paragraph.children.map((span) => span.text).join('')).toBe('A bold link.')
    expect(paragraph.markDefs[0]).toMatchObject({
      _type: 'link',
      url: 'https://sanity.io',
    })
    expect(paragraph.markDefs[0]).not.toHaveProperty('isInternal')
    expect(blocks[2]).toMatchObject({ _type: 'docsCallout', type: 'tip' })
    expect(blocks[3]).toMatchObject({
      _type: 'codeBlock',
      blocks: [
        { _type: 'object', code: { _type: 'code', language: 'ts', code: 'const count = 2' } },
      ],
    })
  })

  test('reports unsupported structure instead of calling a lossy conversion lossless', () => {
    const result = convert(
      '# Too large a heading\n\n![A diagram](https://example.com/image.png)',
      target,
    )
    expect(result.warnings.some((warning) => warning.includes('heading'))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('image'))).toBe(true)
    expect(result.blocks.some((block) => block._type === 'image')).toBe(false)
  })

  test('finds and converts plain text for every discovered rich text field', async () => {
    expect(defaultSchema.targets.length).toBeGreaterThan(50)
    for (const candidate of defaultSchema.targets) {
      const result = await runPortableText(
        { source: 'A paragraph with no special formatting.', target: candidate.id, threshold: 0.8 },
        new AbortController().signal,
      )
      expect(result.value, candidate.id).toHaveLength(1)
      expect(result.errors, candidate.id).toEqual([])
    }
  }, 20_000)

  test('runs a deterministic baseline without provider keys or model requests', async () => {
    const output = await runPortableText(
      {
        source: '## Heading\n\nBody.',
        target: target.id,
        threshold: 0.8,
      },
      new AbortController().signal,
    )
    expect(output.value).toHaveLength(2)
    expect(output.trace.every((step) => step.engine === 'Code')).toBe(true)
    expect(output.errors).toEqual([])
  })
})

test('uses schema fields for renamed callouts, tabbed code, and link annotations', () => {
  const registry = createSchema({
    types: {
      journal: {
        extends: 'document',
        fields: [
          {
            name: 'manuscript',
            typeDef: {
              extends: 'array',
              of: [
                {
                  name: 'block',
                  typeDef: {
                    extends: 'block',
                    fields: [
                      {
                        name: 'markDefs',
                        typeDef: {
                          extends: 'array',
                          of: [
                            {
                              name: 'citation',
                              typeDef: {
                                extends: 'object',
                                fields: [{ name: 'destination', typeDef: { extends: 'url' } }],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  name: 'admonition',
                  typeDef: {
                    extends: 'object',
                    fields: [
                      {
                        name: 'severity',
                        typeDef: { extends: 'string', options: { list: ['tip', 'warning'] } },
                      },
                      {
                        name: 'paragraphs',
                        typeDef: {
                          extends: 'array',
                          of: [{ name: 'block', typeDef: { extends: 'block' } }],
                        },
                      },
                    ],
                  },
                },
                {
                  name: 'sampleRack',
                  typeDef: {
                    extends: 'object',
                    fields: [
                      {
                        name: 'variants',
                        typeDef: {
                          extends: 'array',
                          of: [
                            {
                              name: 'sampleTab',
                              typeDef: {
                                extends: 'object',
                                fields: [
                                  { name: 'listing', typeDef: { extends: 'sourceListing' } },
                                ],
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
        ],
      },
      sourceListing: {
        extends: 'object',
        fields: [
          { name: 'payload', typeDef: { extends: 'text', title: 'Code' } },
          { name: 'dialect', typeDef: { extends: 'string', title: 'Language' } },
        ],
      },
    },
  })
  const target = registry.getTarget('journal.manuscript')
  const result = convert(
    '[Read](https://example.com)\n\n> [!TIP]\n> Keep this.\n\n```ts\nconst n = 1\n```',
    target,
    registry,
  )
  expect(result.blocks[0]).toMatchObject({
    markDefs: [{ _type: 'citation', destination: 'https://example.com' }],
  })
  expect(serialize([result.blocks[0]], target, registry)).toContain('[Read](https://example.com)')
  expect(result.blocks[1]).toMatchObject({
    _type: 'admonition',
    severity: 'tip',
    paragraphs: [{ children: [{ text: 'Keep this.' }] }],
  })
  expect(result.blocks[2]).toMatchObject({
    _type: 'sampleRack',
    variants: [
      {
        _type: 'sampleTab',
        _key: expect.any(String),
        listing: { _type: 'sourceListing', payload: 'const n = 1', dialect: 'ts' },
      },
    ],
  })
  expect(JSON.stringify(result.blocks)).not.toMatch(
    /"(?:codeBlock|docsCallout|content|body|blocks)":/,
  )
})

test('a familiar custom type name does not authorize an invented object shape', () => {
  const registry = createSchema({
    types: {
      entry: {
        extends: 'document',
        fields: [
          {
            name: 'prose',
            typeDef: {
              extends: 'array',
              of: [
                { name: 'block', typeDef: { extends: 'block' } },
                {
                  name: 'codeBlock',
                  typeDef: {
                    extends: 'object',
                    fields: [{ name: 'count', typeDef: { extends: 'number' } }],
                  },
                },
                {
                  name: 'docsCallout',
                  typeDef: {
                    extends: 'object',
                    fields: [{ name: 'enabled', typeDef: { extends: 'boolean' } }],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  })
  const result = convert(
    '```ts\nconst n = 1\n```\n\n> [!TIP]\n> Keep this.',
    registry.getTarget('entry.prose'),
    registry,
  )
  expect(result.blocks.every((block) => block._type === 'block')).toBe(true)
  expect(result.warnings.length).toBeGreaterThan(0)
})
