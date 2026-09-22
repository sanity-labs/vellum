import { expect, test } from 'vitest'
import { convert } from '../rich-text/convert'
import { createSchema, defaultSchema } from '../schema/registry'
import { directSourceEdits, sourceChanges } from './source-update'

const source =
  '# Original title\n\nslug: original\n\nShips tomorow with **care**.\n\nAn unchanged ending.'
const document = {
  _type: 'post',
  title: 'Original title',
  slug: { _type: 'slug', current: 'original' },
  text: convert(
    'Ships tomorow with **care**.\n\nAn unchanged ending.',
    defaultSchema.getTarget('post.text'),
  ).blocks,
}

test('extracts separate changed lines without sending unchanged article contents', () => {
  const next = source.replace('Original title', 'New title').replace('tomorow', 'tomorrow')
  const changes = sourceChanges(source, next)
  expect(changes?.map(({ before, after }) => ({ before, after }))).toEqual([
    { before: '# Original title', after: '# New title' },
    { before: 'Ships tomorow with **care**.', after: 'Ships tomorrow with **care**.' },
  ])
  expect(
    changes && directSourceEdits(changes, source, document, defaultSchema, 'post'),
  ).toMatchObject([
    { op: 'set', path: ['title'], value: 'New title' },
    { op: 'replaceText', path: ['text'], replacement: expect.stringContaining('Ships tomorrow') },
  ])
})

test('sets the existing slug directly and leaves a new instruction out of diff mode', () => {
  const changes = sourceChanges(source, source.replace('slug: original', 'slug: changed'))
  expect(changes && directSourceEdits(changes, source, document, defaultSchema, 'post')).toEqual([
    { op: 'set', path: ['slug', 'current'], value: 'changed' },
  ])
  expect(sourceChanges(source, 'Change the title to Something new.')).toBeUndefined()
  expect(directSourceEdits([], source, document, defaultSchema, 'post')).toEqual([])
})

test('does not guess between repeated field values or repeated passages', () => {
  const changes = sourceChanges(source, source.replace('Original title', 'New title'))
  expect(
    changes &&
      directSourceEdits(
        changes,
        source,
        { ...document, description: 'Original title' },
        defaultSchema,
        'post',
      ),
  ).toBeUndefined()
  const repeated = 'A repeated line.\n\nA repeated line.\n\nEnd.'
  const diff = sourceChanges(repeated, repeated.replace('A repeated line.', 'A changed line.'))
  expect(
    diff &&
      directSourceEdits(
        diff,
        repeated,
        { ...document, text: convert(repeated, defaultSchema.getTarget('post.text')).blocks },
        defaultSchema,
        'post',
      ),
  ).toBeUndefined()
})

test('matches renamed fields by unique existing values, including nested slug aliases', () => {
  const registry = createSchema({
    types: {
      address: { extends: 'slug' },
      page: {
        extends: 'document',
        fields: [
          { name: 'headline', typeDef: { extends: 'string' } },
          {
            name: 'settings',
            typeDef: {
              extends: 'object',
              fields: [{ name: 'permalink', typeDef: { extends: 'address' } }],
            },
          },
        ],
      },
    },
  })
  const before = 'Page name: Original headline\nURL: /original-path\n\nUnchanged body.'
  const after = before
    .replace('Original headline', 'Updated headline')
    .replace('/original-path', '/new-path')
  const doc = {
    _type: 'page',
    headline: 'Original headline',
    settings: { permalink: { _type: 'slug', current: 'original-path' } },
  }
  const changes = sourceChanges(before, after)
  expect(changes && directSourceEdits(changes, before, doc, registry, 'page')).toEqual([
    { op: 'set', path: ['headline'], value: 'Updated headline' },
    { op: 'set', path: ['settings', 'permalink', 'current'], value: 'new-path' },
  ])
  const repeated = `${before}\n\nExample URL: /original-path`
  const repeatedChanges = sourceChanges(
    repeated,
    repeated.replace('URL: /original-path', 'URL: /new-path'),
  )
  expect(
    repeatedChanges && directSourceEdits(repeatedChanges, repeated, doc, registry, 'page'),
  ).toBeUndefined()
})

test('keeps unicode and merges multiple changes on one line', () => {
  const before = 'Start\n\nMünchen → 東京 costs €0.00.\n\nEnding'
  const changes = sourceChanges(before, 'Start\n\nMünchen → 大阪 costs €1.00.\n\nEnding')
  expect(changes?.map(({ before, after }) => ({ before, after }))).toEqual([
    { before: 'München → 東京 costs €0.00.', after: 'München → 大阪 costs €1.00.' },
  ])
})

test('does not guess when different Markdown spellings produce identical headings', () => {
  const source = 'Introduction.\n\n## Enter <LogoSoup />\n\n## Enter \\<LogoSoup />\n\nEnding.'
  const changes = sourceChanges(
    source,
    source.replace('## Enter <LogoSoup />', '## Enter `<LogoSoup />`'),
  )
  expect(
    changes &&
      directSourceEdits(
        changes,
        source,
        {
          _type: 'post',
          text: convert(source, defaultSchema.getTarget('post.text')).blocks,
        },
        defaultSchema,
        'post',
      ),
  ).toBeUndefined()
})
