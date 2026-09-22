import { afterEach, expect, test, vi } from 'vitest'
import pageBuilderSource from '../../examples/atlas-brief.md?raw'
import logoSoupSource from '../../examples/logo-soup.md?raw'
import { textBlock } from '../../shared/contracts'
import { documentVersion, editOperations, type JsonObject } from '../../shared/json'
import { fakeJev } from '../jev/fake'
import { convert } from '../rich-text/convert'
import { createSchema, defaultSchema } from '../schema/registry'
import { applyDocumentEdits, documentPatchRequest, runDocumentPatch } from './patch'
import { documentDiff } from './patch-diff'

const signal = () => new AbortController().signal
const pageRegistry = createSchema({
  types: {
    page: {
      extends: 'document',
      fields: [
        { name: 'title', typeDef: { extends: 'string' } },
        {
          name: 'items',
          typeDef: {
            extends: 'array',
            of: [
              {
                name: 'card',
                typeDef: {
                  extends: 'object',
                  fields: [
                    { name: 'title', typeDef: { extends: 'string' } },
                    { name: 'enabled', typeDef: { extends: 'boolean' } },
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
const page = {
  _type: 'page',
  title: 'Original',
  items: [
    { _type: 'card', _key: 'one', title: 'First', enabled: true },
    { _type: 'card', _key: 'two', title: 'Second', enabled: false },
  ],
}
async function request(document: JsonObject, source = 'Make the requested changes.') {
  return documentPatchRequest.parse({
    document,
    baseVersion: await documentVersion(document),
    source,
  })
}
const plan = (edits: unknown[]) => editOperations.parse(edits)

test('refuses instruction-only updates without a source baseline or document changes', async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Unexpected network call')
  })
  const doc = { _type: 'post', title: 'Original' }
  const before = structuredClone(doc)
  const version = await documentVersion(doc)
  for (const extra of [{ source: 'Rewrite this into a sales pitch.' }]) {
    await expect(
      runDocumentPatch(
        documentPatchRequest.parse({
          document: doc,
          baseVersion: version,
          ...extra,
        }),
        signal(),
      ),
    ).rejects.toThrow('Nothing was changed')
    expect(doc).toEqual(before)
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('targets keyed items, preserves unrelated fields, and creates fresh keys only for inserted content', async () => {
  const before = structuredClone(page)
  const edited = await applyDocumentEdits(
    await request(page),
    plan([
      {
        op: 'set',
        path: ['items', { _key: 'two' }, 'title'],
        value: 'Updated second',
      },
    ]),
    pageRegistry,
    signal(),
  )
  const appended = await applyDocumentEdits(
    await request(edited.document),
    plan([
      {
        op: 'insertBefore',
        path: ['items'],
        anchor: 'one',
        value: [{ _type: 'card', title: 'New', enabled: false }],
      },
    ]),
    pageRegistry,
    signal(),
  )
  expect(appended.document.items).toEqual([
    expect.objectContaining({
      title: 'New',
      _key: expect.any(String),
      enabled: false,
    }),
    page.items[0],
    { ...page.items[1], title: 'Updated second' },
  ])
  expect(appended.validation.errors).toEqual([])
  expect(page).toEqual(before)
  expect(documentDiff(page, edited.document)).toEqual([
    { set: { '["items"][_key=="two"]["title"]': 'Updated second' } },
  ])
  expect(documentDiff(edited.document, appended.document)).toEqual([
    {
      insert: {
        before: '["items"][0]',
        items: [expect.objectContaining({ title: 'New' })],
      },
    },
  ])
})

test('preserves rich-text block, span, annotation, image and code identities when fixing a word', async () => {
  const target = defaultSchema.getTarget('post.text')
  const body = convert(
    'Ships tomorow. A **bold** [link](https://example.com).\n\nUnchanged ending.',
    target,
  ).blocks
  const custom = {
    _type: 'image',
    _key: 'asset',
    alt: 'Original',
    asset: { _type: 'reference', _ref: 'image-existing-100x100-png' },
  }
  const code = {
    _type: 'code',
    _key: 'code',
    code: 'const untouched = true',
    language: 'js',
  }
  const doc = { _type: 'post', title: 'A post', text: [...body, custom, code] }
  const before = structuredClone(doc)
  const output = await applyDocumentEdits(
    await request(doc),
    plan([
      {
        op: 'replaceText',
        path: ['text'],
        search: 'tomorow',
        replacement: 'tomorrow',
      },
    ]),
    defaultSchema,
    signal(),
  )
  const expected = JSON.parse(JSON.stringify(before).replace('tomorow', 'tomorrow'))
  expect(output.document).toEqual(expected)
  expect(doc).toEqual(before)
  const first = textBlock.parse(body[0])
  expect(documentDiff(doc, output.document)).toEqual([
    {
      set: {
        [`["text"][_key==${JSON.stringify(first._key)}]["children"][_key==${JSON.stringify(first.children[0]._key)}]["text"]`]:
          'Ships tomorrow. A ',
      },
    },
  ])
})

test('appends rich text without reserializing or changing any existing block', async () => {
  const body = convert('Existing **content**.', defaultSchema.getTarget('post.text')).blocks
  const doc = { _type: 'post', text: body }
  const output = await applyDocumentEdits(
    await request(doc),
    plan([{ op: 'append', path: ['text'], value: 'New paragraph.' }]),
    defaultSchema,
    signal(),
  )
  expect(output.document.text).toEqual([...body, expect.objectContaining({ _type: 'block' })])
  expect(documentDiff(doc, output.document)).toEqual([
    {
      insert: {
        after: `["text"][_key==${JSON.stringify(body[0]._key)}]`,
        items: [expect.objectContaining({ _type: 'block' })],
      },
    },
  ])
})

test.each([
  [
    {
      op: 'set',
      path: ['items', { _key: 'missing' }, 'title'],
      value: 'Changed',
    },
  ],
  [{ op: 'set', path: ['items'], value: [] }],
  [{ op: 'set', path: ['madeUp'], value: 'Changed' }],
  [{ op: 'set', path: ['items', { _key: 'one' }, 'enabled'], value: 'false' }],
  [
    { op: 'set', path: ['title'], value: 'Changed' },
    { op: 'unset', path: ['title'] },
  ],
])('rejects unsafe plans atomically (%j)', async (...edits) => {
  const before = structuredClone(page)
  await expect(
    applyDocumentEdits(await request(page), plan(edits), pageRegistry, signal()),
  ).rejects.toThrow()
  expect(page).toEqual(before)
})

test('rejects stale snapshots, duplicate keys, ambiguous text, and system-field paths', async () => {
  const input = await request(page)
  input.document.title = 'Changed elsewhere'
  await expect(applyDocumentEdits(input, plan([]), pageRegistry, signal())).rejects.toThrow(
    /base document changed/,
  )
  await expect(
    applyDocumentEdits(
      await request({ ...page, items: [page.items[0], page.items[0]] }),
      plan([]),
      pageRegistry,
      signal(),
    ),
  ).rejects.toThrow(/unique keys/)
  await expect(
    applyDocumentEdits(
      await request({ ...page, title: 'Repeat Repeat' }),
      plan([
        {
          op: 'replaceText',
          path: ['title'],
          search: 'Repeat',
          replacement: 'New',
        },
      ]),
      pageRegistry,
      signal(),
    ),
  ).rejects.toThrow(/more than once/)
  for (const path of [['_type'], ['__proto__'], ['constructor'], ['items', 0, 'title']])
    expect(() => plan([{ op: 'set', path, value: 'no' }])).toThrow()
})

test('removes only the requested keyed item and preserves explicit false values', async () => {
  const result = await applyDocumentEdits(
    await request(page),
    plan([{ op: 'unset', path: ['items', { _key: 'one' }] }]),
    pageRegistry,
    signal(),
  )
  expect(result.document).toEqual({ ...page, items: [page.items[1]] })
  expect(documentDiff(page, result.document)).toEqual([{ unset: ['["items"][_key=="one"]'] }])
})

test('does not apply cancelled plans', async () => {
  const abort = new AbortController()
  abort.abort()
  const before = structuredClone(page)
  await expect(
    applyDocumentEdits(
      await request(page),
      plan([{ op: 'set', path: ['title'], value: 'Changed' }]),
      pageRegistry,
      abort.signal,
    ),
  ).rejects.toThrow()
  expect(page).toEqual(before)
})

test('rejects references smuggled through new Markdown objects', async () => {
  const doc = {
    _type: 'post',
    text: convert('Original.', defaultSchema.getTarget('post.text')).blocks,
  }
  await expect(
    applyDocumentEdits(
      await request(doc),
      plan([
        {
          op: 'append',
          path: ['text'],
          value:
            '```json:object\n{"_type":"image","_key":"fake","asset":{"_type":"reference","_ref":"invented"}}\n```',
        },
      ]),
      defaultSchema,
      signal(),
    ),
  ).rejects.toThrow(/references|mapped/)
})

test('an unchanged value produces no mutations or key churn', async () => {
  const output = await applyDocumentEdits(
    await request(page),
    plan([{ op: 'set', path: ['title'], value: page.title }]),
    pageRegistry,
    signal(),
  )
  expect(output.document).toEqual(page)
  expect(await documentVersion(output.document)).toBe(await documentVersion(page))
  expect(documentDiff(page, output.document)).toEqual([])
})

test('patches the implicit slug.current field without replacing the slug or unrelated keys', async () => {
  const document = {
    _type: 'post',
    title: 'Original',
    slug: { _type: 'slug', current: 'original' },
    text: convert('Keep this content.', defaultSchema.getTarget('post.text')).blocks,
  }
  const input = await request(document)
  const output = await applyDocumentEdits(
    input,
    plan([{ op: 'set', path: ['slug', 'current'], value: 'updated-slug' }]),
    defaultSchema,
    signal(),
  )
  expect(output.document).toEqual({
    ...document,
    slug: { ...document.slug, current: 'updated-slug' },
  })
  expect(document.slug.current).toBe('original')
  expect(documentDiff(document, output.document)).toEqual([
    { set: { '["slug"]["current"]': 'updated-slug' } },
  ])
  expect(
    output.validation.markers.filter(
      (marker) => marker.level === 'error' && marker.path[0] === 'slug',
    ),
  ).toEqual([])
  await expect(
    applyDocumentEdits(
      input,
      plan([{ op: 'set', path: ['slug', 'current'], value: 123 }]),
      defaultSchema,
      signal(),
    ),
  ).rejects.toThrow()
  await expect(
    applyDocumentEdits(
      input,
      plan([{ op: 'set', path: ['slug', 'madeUp'], value: 'no' }]),
      defaultSchema,
      signal(),
    ),
  ).rejects.toThrow(/not in the schema/)
})

test('resolves implicit slug fields through aliases inside keyed arrays', async () => {
  const registry = createSchema({
    types: {
      urlSlug: { extends: 'slug' },
      page: {
        extends: 'document',
        fields: [
          {
            name: 'items',
            typeDef: {
              extends: 'array',
              of: [
                {
                  name: 'card',
                  typeDef: {
                    extends: 'object',
                    fields: [{ name: 'slug', typeDef: { extends: 'urlSlug' } }],
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
    items: [{ _type: 'card', _key: 'keep', slug: { _type: 'slug' } }],
  }
  const output = await applyDocumentEdits(
    await request(document),
    plan([
      {
        op: 'set',
        path: ['items', { _key: 'keep' }, 'slug', 'current'],
        value: 'new-slug',
      },
    ]),
    registry,
    signal(),
  )
  expect(output.document).toEqual({
    _type: 'page',
    items: [{ ...document.items[0], slug: { _type: 'slug', current: 'new-slug' } }],
  })
  expect(output.validation.errors).toEqual([])
})

test.each(['new-slug', { current: 'new-slug' }, { _type: 'slug', current: 'new-slug' }])(
  'normalizes slug values while preserving existing slug metadata (%j)',
  async (value) => {
    const document = {
      _type: 'post',
      title: 'Keep',
      slug: { _type: 'slug', current: 'old', source: 'title' },
    }
    const output = await applyDocumentEdits(
      await request(document),
      plan([{ op: 'set', path: ['slug'], value }]),
      defaultSchema,
      signal(),
    )
    expect(output.document).toEqual({
      ...document,
      slug: { ...document.slug, current: 'new-slug' },
    })
    expect(documentDiff(document, output.document)).toEqual([
      { set: { '["slug"]["current"]': 'new-slug' } },
    ])
    const created = await applyDocumentEdits(
      await request({ _type: 'post' }),
      plan([{ op: 'set', path: ['slug'], value }]),
      defaultSchema,
      signal(),
    )
    expect(created.document.slug).toEqual({
      _type: 'slug',
      current: 'new-slug',
    })
  },
)

test('creates a missing slug container for an explicit current edit, without creating arbitrary parents', async () => {
  const document = { _type: 'post', title: 'Keep' }
  const output = await applyDocumentEdits(
    await request(document),
    plan([{ op: 'set', path: ['slug', 'current'], value: 'new-slug' }]),
    defaultSchema,
    signal(),
  )
  expect(output.document).toEqual({
    ...document,
    slug: { _type: 'slug', current: 'new-slug' },
  })
  await expect(
    applyDocumentEdits(
      await request(document),
      plan([{ op: 'set', path: ['image', 'alt'], value: 'No implicit image' }]),
      defaultSchema,
      signal(),
    ),
  ).rejects.toThrow(/parent object is missing/)
  await expect(
    applyDocumentEdits(
      await request(document),
      plan([
        {
          op: 'set',
          path: ['slug'],
          value: { _type: 'slug', current: 'new-slug', madeUp: true },
        },
      ]),
      defaultSchema,
      signal(),
    ),
  ).rejects.toThrow()
})

test('updates an aliased page-builder slug locally and preserves the assembled page', async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('An existing field edit must not call a provider')
  })
  const doc = {
    _type: 'landingPage',
    title: 'Atlas | Plan together. Deliver with confidence.',
    slug: { _type: 'slug', current: 'atlas-for-teams' },
    content: [{ _type: 'heroPageBlock', _key: 'keep-hero', title: 'Plan together.' }],
  }
  const version = await documentVersion(doc)
  const source = pageBuilderSource.replace('/atlas-for-teams', '/atlas-for-everyone')
  const result = await runDocumentPatch(
    documentPatchRequest.parse({
      document: doc,
      baseVersion: version,
      source,
      sourceBaseline: { source: pageBuilderSource, version },
    }),
    signal(),
  )
  expect(result.document).toEqual({
    ...doc,
    slug: { ...doc.slug, current: 'atlas-for-everyone' },
  })
  expect(result.patch?.mutations).toEqual([
    { set: { '["slug"]["current"]': 'atlas-for-everyone' } },
  ])
  expect(result.trace.every((step) => step.engine === 'Code')).toBe(true)
  expect(result.sourceBaseline?.source).toBe(source.trim())
})

test('applies source-only changes without inference, preserves keys, and advances the baseline', async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('No inference expected')
  })
  const source = '# A post\n\nslug: original\n\nShips tomorow.\n\nUnchanged ending.'
  const doc = {
    _type: 'post',
    title: 'A post',
    slug: { _type: 'slug', current: 'original' },
    text: convert('Ships tomorow.\n\nUnchanged ending.', defaultSchema.getTarget('post.text'))
      .blocks,
  }
  const version = await documentVersion(doc)
  const input = documentPatchRequest.parse({
    document: doc,
    baseVersion: version,
    source: source.replace('slug: original', 'slug: changed').replace('tomorow', 'tomorrow'),
    sourceBaseline: { source, version },
  })
  const result = await runDocumentPatch(input, signal())
  const expected = JSON.parse(
    JSON.stringify(doc).replace('"original"', '"changed"').replace('tomorow', 'tomorrow'),
  )
  expect(result.document).toEqual(expected)
  expect(result.trace[0]).toMatchObject({
    engine: 'Code',
    inputTokens: 0,
    outputTokens: 0,
  })
  expect(result.sourceBaseline).toEqual({
    source: input.source,
    version: await documentVersion(expected),
  })
  const noop = await runDocumentPatch(
    documentPatchRequest.parse({
      ...input,
      document: result.document,
      baseVersion: result.patch?.version,
      sourceBaseline: result.sourceBaseline,
    }),
    signal(),
  )
  expect(noop.document).toEqual(result.document)
  expect(noop.patch?.edits).toBe(0)
  await expect(
    runDocumentPatch({ ...input, sourceBaseline: { source, version: '0'.repeat(64) } }, signal()),
  ).rejects.toThrow(/baseline/)
})

test.each([
  ['before', 'B000'],
  ['middle', 'B002'],
  ['after', 'B003'],
])('binds a new block at %s through Jev without touching existing blocks', async (position, id) => {
  const requests = fakeJev({ assign: { [id]: ['slug'] } })
  const heading = '# The logo soup problem'
  const paragraphs = ['Why do logo clouds look like a ransom note?', 'Keep **this** unchanged.']
  const source = [heading, ...paragraphs].join('\n\n')
  const chunks = [heading, ...paragraphs]
  chunks.splice(Number(id.slice(1)), 0, '/logo-soup-problem')
  const doc = {
    _type: 'post',
    title: 'The logo soup problem',
    text: convert(paragraphs.join('\n\n'), defaultSchema.getTarget('post.text')).blocks,
  }
  const version = await documentVersion(doc)
  const result = await runDocumentPatch(
    documentPatchRequest.parse({
      document: doc,
      baseVersion: version,
      source: chunks.join('\n\n'),
      sourceBaseline: { source, version },
    }),
    signal(),
  )
  expect(position).toBeTruthy()
  expect(result.document).toEqual({
    ...doc,
    slug: { _type: 'slug', current: 'logo-soup-problem' },
  })
  expect(result.patch?.mutations).toHaveLength(1)
  const asked = requests.flatMap((request) => Object.keys(request.questions))
  expect(asked.filter((question) => question.startsWith('assign:'))).toEqual([`assign:${id}`])
})

test('replaces, removes, and refuses ambiguous field values from source edits', async () => {
  const source = '# A document\n\nKeep this paragraph intact.\n\nSlug: /first-path'
  const doc = {
    _type: 'post',
    title: 'A document',
    slug: { _type: 'slug', current: 'first-path' },
    text: convert('Keep this paragraph intact.', defaultSchema.getTarget('post.text')).blocks,
  }
  const version = await documentVersion(doc)
  const patch = (next: string) =>
    runDocumentPatch(
      documentPatchRequest.parse({
        document: doc,
        baseVersion: version,
        sourceBaseline: { source, version },
        source: next,
      }),
      signal(),
    )
  fakeJev({ assign: { 'B002.value': ['slug'] } })
  const replaced = await patch(source.replace('first-path', 'next-path'))
  expect(replaced.document).toEqual({
    ...doc,
    slug: { _type: 'slug', current: 'next-path' },
  })
  const removed = await patch(source.replace('\n\nSlug: /first-path', ''))
  const { slug: _slug, ...withoutSlug } = doc
  expect(removed.document).toEqual(withoutSlug)
  await expect(patch(`${source}\n\n/another-path`)).rejects.toThrow('ambiguous')
  expect(doc.slug.current).toBe('first-path')
})

test.each(['## Enter <LogoSoup />', '## Enter \\<LogoSoup />'])(
  'adds inline code to the Logo Soup heading locally (%s)',
  async (heading) => {
    vi.stubGlobal('fetch', () => {
      throw new Error('Formatting changes must not call a provider')
    })
    const source = logoSoupSource.replace('## Enter <LogoSoup />', heading)
    const body = convert(source, defaultSchema.getTarget('post.text')).blocks
    const original = body
      .map((block) => textBlock.safeParse(block))
      .find(
        (parsed) =>
          parsed.success &&
          parsed.data.children.some((span) => span.text.includes('Enter <LogoSoup />')),
      )
    if (!original?.success) throw new Error('Expected the original heading')
    const document = {
      _type: 'post',
      title: 'The logo soup problem',
      text: body,
    }
    const version = await documentVersion(document)
    const result = await runDocumentPatch(
      documentPatchRequest.parse({
        document,
        baseVersion: version,
        sourceBaseline: { source, version },
        source: source.replace(heading, '## Enter `<LogoSoup />`'),
      }),
      signal(),
    )
    expect(result.trace[0]).toMatchObject({
      engine: 'Code',
      inputTokens: 0,
      outputTokens: 0,
    })
    const updated = documentPatchRequest.shape.document.parse(result.document)
    if (!Array.isArray(updated.text)) throw new Error('Expected rich text')
    const index = body.findIndex((block) => block._key === original.data._key)
    const changed = textBlock.parse(updated.text[index])
    expect(changed).toMatchObject({ _key: original.data._key, style: 'h2' })
    expect(changed.children).toContainEqual(
      expect.objectContaining({ text: '<LogoSoup />', marks: ['code'] }),
    )
    expect(updated.text.filter((_, i) => i !== index)).toEqual(body.filter((_, i) => i !== index))
    expect(document.text).toEqual(body)
  },
)
