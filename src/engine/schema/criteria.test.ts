import { expect, test } from 'vitest'
import { documentCriteria } from './criteria'
import { createSchema, defaultSchema } from './registry'

test('keeps every bundled document type in a compact context without changing its schema', () => {
  const before = JSON.stringify(defaultSchema.descriptor)
  const context = documentCriteria(defaultSchema)
  expect(Object.keys(context).sort()).toEqual(
    defaultSchema.documents.map((type) => type.name).sort(),
  )
  expect(context.article).toContain('documentation, official guides, and help articles')
  expect(context.post).toContain('blog feed')
  expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThan(50_000)
  expect(JSON.stringify(defaultSchema.descriptor)).toBe(before)
  expect(documentCriteria(defaultSchema)).toBe(context)
})

test('preserves inherited document types and keeps pasted schema contexts isolated', () => {
  const one = createSchema({
    types: {
      base: {
        extends: 'document',
        fields: [{ name: 'headline', typeDef: { extends: 'string', title: 'Headline' } }],
      },
      entry: { extends: 'base', title: 'Editorial', description: 'Long-form stories.' },
    },
  })
  const two = createSchema({
    types: {
      entry: {
        extends: 'document',
        title: 'Invoice',
        fields: [{ name: 'total', typeDef: { extends: 'number' } }],
      },
    },
  })
  expect(documentCriteria(one).entry).toContain('Title: Editorial')
  expect(documentCriteria(one).entry).toContain('Long-form stories.')
  expect(documentCriteria(one).entry).toContain('headline')
  expect(documentCriteria(two).entry).toContain('Title: Invoice')
  expect(documentCriteria(two).entry).not.toContain('headline')
  expect(documentCriteria(one).entry).not.toContain('total')
})
