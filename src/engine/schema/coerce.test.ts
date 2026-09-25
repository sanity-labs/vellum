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
