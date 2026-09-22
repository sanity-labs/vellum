import { afterEach, expect, test, vi } from 'vitest'
import { documentVersion, type JsonObject } from '../../shared/json'
import { convert } from '../rich-text/convert'
import { defaultSchema } from '../schema/registry'
import { documentPatchRequest, runDocumentPatch } from './patch'
import { directObjectSourceEdits } from './source-update'

const target = defaultSchema.getTarget('article.content')
const source =
  '# Example\n\nBefore.\n\n> [!TIP]\n> Keep this copy with [a link](https://example.com).\n\n```ts\nconst count = 1\nconsole.log(count)\n```\n\n![Original diagram.](https://example.com/diagram.png)\n\nAfter.'
function fixture() {
  return {
    _type: 'article',
    title: 'Example',
    layout: 'default',
    slug: { _type: 'slug', current: 'example' },
    content: [
      ...convert(
        source
          .slice(source.indexOf('Before.'))
          .replace('![Original diagram.](https://example.com/diagram.png)\n\n', ''),
        target,
      ).blocks,
      {
        _type: 'image',
        _key: 'image',
        alt: 'Original diagram.',
        asset: { _type: 'reference', _ref: 'image-existing-100x100-png' },
      },
    ],
  }
}

afterEach(() => vi.unstubAllGlobals())

test.each([
  ['callout', 'Keep this copy', 'Keep the revised copy'],
  [
    'multiline code',
    'const count = 1\nconsole.log(count)',
    'const count = 2\nconsole.log("count", count)',
  ],
  ['image alt', 'Original diagram.', 'Revised diagram.'],
])(
  'updates %s from source without inference or unrelated changes',
  async (_name, before, after) => {
    vi.stubGlobal('fetch', () => {
      throw new Error('No provider request expected')
    })
    const document = fixture()
    const version = await documentVersion(document)
    const result = await runDocumentPatch(
      documentPatchRequest.parse({
        document,
        baseVersion: version,
        sourceBaseline: { source, version },
        source: source.replace(before, after),
      }),
      new AbortController().signal,
    )
    const expected = JSON.parse(
      JSON.stringify(document).replace(
        JSON.stringify(before).slice(1, -1),
        JSON.stringify(after).slice(1, -1),
      ),
    )
    expect(result.document).toEqual(expected)
    expect(result.trace[0]).toMatchObject({ engine: 'Code', inputTokens: 0, outputTokens: 0 })
    expect(result.sourceBaseline?.version).toBe(await documentVersion(expected))
    expect(result.errors).toEqual([])
  },
)

test('combines independent custom text changes and preserves existing metadata', async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('No provider request expected')
  })
  const document = fixture()
  document.content = document.content.map((block) =>
    block._type === 'codeBlock' ? { ...block, title: 'Keep metadata' } : block,
  )
  const version = await documentVersion(document)
  const next = source
    .replace('const count = 1', 'const count = 2')
    .replace('Original diagram.', 'Revised diagram.')
    .replace('Keep this copy', 'Keep the revised copy')
  const result = await runDocumentPatch(
    documentPatchRequest.parse({
      document,
      baseVersion: version,
      sourceBaseline: { source, version },
      source: next,
    }),
    new AbortController().signal,
  )
  expect(result.document).toEqual(
    JSON.parse(
      JSON.stringify(document)
        .replace('const count = 1', 'const count = 2')
        .replace('Original diagram.', 'Revised diagram.')
        .replace('Keep this copy', 'Keep the revised copy'),
    ),
  )
  expect(result.patch?.edits).toBe(3)
  expect(result.trace[0].engine).toBe('Code')
})

test.each([
  source.replace('diagram.png', 'different.png'),
  source.replace('Original diagram.', 'Revised diagram.').replace('Before.', 'New prose.'),
  source.replace('Keep this copy', 'Keep **this** copy'),
  source.replace('![Original diagram.](https://example.com/diagram.png)', ''),
])('declines reference, structure, or mixed prose changes it cannot fully explain', (next) => {
  expect(directObjectSourceEdits(source, next, fixture(), defaultSchema, 'article')).toBeUndefined()
})

test('declines duplicate source objects, duplicate stored objects, and stale content', () => {
  const document = fixture()
  const next = source.replace('Original diagram.', 'Revised diagram.')
  expect(
    directObjectSourceEdits(
      source,
      next,
      {
        ...document,
        content: [
          ...document.content,
          { _type: 'image', _key: 'duplicate', alt: 'Original diagram.' },
        ],
      },
      defaultSchema,
      'article',
    ),
  ).toBeUndefined()
  const repeated = `${source}\n\n![Original diagram.](https://example.com/other.png)`
  expect(
    directObjectSourceEdits(
      repeated,
      repeated.replace('Original diagram.', 'Revised diagram.'),
      document,
      defaultSchema,
      'article',
    ),
  ).toBeUndefined()
  expect(
    directObjectSourceEdits(
      source,
      next,
      { ...document, content: document.content.filter((block) => block._type !== 'image') },
      defaultSchema,
      'article',
    ),
  ).toBeUndefined()
  expect(
    directObjectSourceEdits(
      source,
      source.replace('Keep this copy', 'New copy'),
      JSON.parse(JSON.stringify(document).replace('Keep this copy', 'Already edited')),
      defaultSchema,
      'article',
    ),
  ).toBeUndefined()
  expect(
    directObjectSourceEdits(
      source,
      source.replace('Original diagram.', 'New alt.'),
      { ...document, image: { _type: 'image', alt: 'Original diagram.' } },
      defaultSchema,
      'article',
    ),
  ).toBeUndefined()
})

test('declines a match copied into another field even when other changes identify one field', () => {
  const document = fixture()
  const image = document.content.find((block) => block._type === 'image')
  if (!image) throw new Error('Expected image fixture')
  expect(
    directObjectSourceEdits(
      source,
      source.replace('Original diagram.', 'New alt.').replace('Keep this copy', 'New copy'),
      { ...document, body: [{ ...image, _key: 'other-field-image' }] },
      defaultSchema,
      'article',
    ),
  ).toBeUndefined()
})

test('uses the new source and document as the baseline for consecutive local updates', async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('No provider request expected')
  })
  const original = fixture()
  const untouched = structuredClone(original)
  let document: JsonObject = original
  let baseline = source
  let version = await documentVersion(document)
  for (const [before, after] of [
    ['Original diagram.', 'A "quoted" diagram.'],
    ['A "quoted" diagram.', 'A diagram of 東京.'],
    ['Keep this copy', 'Keep precise copy'],
    ['Keep precise copy', 'Keep the final copy'],
    ['const count = 1', 'const count = 10'],
    ['const count = 10', 'const count = 0'],
  ]) {
    const next = baseline.replace(before, after)
    const result = await runDocumentPatch(
      documentPatchRequest.parse({
        document,
        baseVersion: version,
        sourceBaseline: { source: baseline, version },
        source: next,
      }),
      new AbortController().signal,
    )
    expect(result.document).toEqual(
      JSON.parse(
        JSON.stringify(document).replace(
          JSON.stringify(before).slice(1, -1),
          JSON.stringify(after).slice(1, -1),
        ),
      ),
    )
    expect(result.trace[0].engine).toBe('Code')
    expect(result.errors).toEqual([])
    if (!result.document || !result.sourceBaseline) throw new Error('Expected an updated baseline')
    document = result.document
    baseline = next
    version = result.sourceBaseline.version
  }
  expect(original).toEqual(untouched)
})
