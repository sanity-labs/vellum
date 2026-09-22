import { expect, test } from 'vitest'
import { defaultSchema } from '../schema/registry'
import { convert, serialize } from './convert'
import { editRichText } from './edit'

const target = defaultSchema.getTarget('article.content')
const image = {
  _type: 'image',
  _key: 'image-key',
  alt: 'Original diagram.',
  asset: { _type: 'reference', _ref: 'image-existing-100x100-png' },
}
const content = [
  ...convert(
    'Before.\n\n> [!TIP]\n> Keep this copy.\n\n```ts\nconst count = 1\n```\n\nAfter.',
    target,
  ).blocks,
  image,
]

test.each([
  ['Original diagram.', 'Updated diagram.'],
  ['Keep this copy.', 'Keep the updated copy.'],
  ['const count = 1', 'const count = 2'],
])(
  'edits existing custom text without changing keys or other fields (%s)',
  (search, replacement) => {
    const before = structuredClone(content)
    const updated = editRichText(content, search, replacement, target, defaultSchema)
    expect(updated).toEqual(JSON.parse(JSON.stringify(content).replace(search, replacement)))
    expect(content).toEqual(before)
  },
)

test.each([
  ['image-existing-100x100-png', 'image-invented-100x100-png'],
  ['"_type": "image"', '"_type": "file"'],
  ['"alt": "Original diagram."', '"unknownField": "Original diagram."'],
  ['"alt": "Original diagram."', '"alt": "Original diagram.", "extra": "Invented"'],
])('rejects structural or reference changes inside a text edit (%s)', (search, replacement) => {
  const before = structuredClone(content)
  expect(() => editRichText(content, search, replacement, target, defaultSchema)).toThrow()
  expect(content).toEqual(before)
})

test('preserves custom objects during changes to multiple surrounding paragraphs', () => {
  const markdown = serialize(content, target)
  const updated = editRichText(
    content,
    markdown,
    markdown.replace('Before.', 'First.').replace('After.', 'Last.'),
    target,
    defaultSchema,
  )
  expect(updated).toEqual(
    JSON.parse(JSON.stringify(content).replace('Before.', 'First.').replace('After.', 'Last.')),
  )
})
