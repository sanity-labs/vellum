import { expect, test } from 'vitest'
import { coerceFieldValue } from './coerce'
import { defaultSchema } from './registry'

const url = { extends: 'url' }

test.each([
  'https://example.com/atlas',
  'http://example.com',
  'mailto:hello@example.com',
  'tel:+4712345678',
  '/atlas-for-teams',
])('%s can fill a url field', (value) => {
  expect(coerceFieldValue(value, url, defaultSchema)).toBe(value)
})

test.each([
  'Venue: Kulturhuset, Youngstorget 3',
  'Starts: 2026-11-12T17:30:00+01:00',
  'plain words',
])('a labeled line like %s is not a url', (value) => {
  expect(coerceFieldValue(value, url, defaultSchema)).toBeUndefined()
})

const tags = { extends: 'array', of: [{ name: 'string', typeDef: { extends: 'string' } }] }

test('a comma-separated line fills a list of strings, one item per value', () => {
  expect(coerceFieldValue('React, Open source; Image processing,', tags, defaultSchema)).toEqual([
    'React',
    'Open source',
    'Image processing',
  ])
  expect(coerceFieldValue('React', tags, defaultSchema)).toEqual(['React'])
  expect(coerceFieldValue('React,\nOpen source', tags, defaultSchema)).toBeUndefined()
  expect(coerceFieldValue(' , ', tags, defaultSchema)).toBeUndefined()
})

test('every item in a list must fit the item type', () => {
  const numbers = { extends: 'array', of: [{ name: 'number', typeDef: { extends: 'number' } }] }
  expect(coerceFieldValue('1, 2; 3.5', numbers, defaultSchema)).toEqual([1, 2, 3.5])
  expect(coerceFieldValue('1, two', numbers, defaultSchema)).toBeUndefined()
})

test('a list with predefined values on the array matches each item to one of them', () => {
  const topics = { ...tags, options: { list: ['Design', 'Product', 'Tutorial'] } }
  expect(coerceFieldValue('design, tutorial', topics, defaultSchema)).toEqual([
    'Design',
    'Tutorial',
  ])
  expect(coerceFieldValue('Design, Cooking', topics, defaultSchema)).toBeUndefined()
})

test('rich text and arrays of objects are not lists', () => {
  const richText = { extends: 'array', of: [{ name: 'block', typeDef: { extends: 'block' } }] }
  expect(coerceFieldValue('One, two', richText, defaultSchema)).toBe('One, two')
  const objects = {
    extends: 'array',
    of: [{ name: 'item', typeDef: { extends: 'object', fields: [] } }],
  }
  expect(coerceFieldValue('One, two', objects, defaultSchema)).toBe('One, two')
})
