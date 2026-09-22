import { isDeepStrictEqual } from 'node:util'
import { applyMarkdownEdit } from '@portabletext/markdown'
import { z } from 'zod'
import { contentNode } from '../../shared/contracts'
import { isObject, type Json } from '../../shared/json'
import type { RichTextTarget, SchemaNode, SchemaRegistry } from '../schema/registry'
import { conversionOptions, serializationOptions, serialize } from './convert'

function isCustomTextChange(
  before: Json,
  after: Json,
  schema: SchemaNode,
  registry: SchemaRegistry,
): boolean {
  if (isDeepStrictEqual(before, after)) return true
  const resolved = registry.resolveType(schema)
  if (['reference', 'crossDatasetReference', 'globalDocumentReference'].includes(resolved.extends))
    return false
  if (typeof before === 'string' && typeof after === 'string')
    return ['string', 'text', 'url'].includes(resolved.extends)
  if (Array.isArray(before) && Array.isArray(after))
    return (
      before.length === after.length &&
      before.every((item, index) => {
        if (isDeepStrictEqual(item, after[index])) return true
        const member = registry
          .members(resolved)
          .find((member) => isObject(item) && member.name === item._type)
        return !!member && isCustomTextChange(item, after[index], member.typeDef, registry)
      })
    )
  if (
    !isObject(before) ||
    !isObject(after) ||
    Object.keys(before).length !== Object.keys(after).length
  )
    return false
  return Object.keys(before).every((key) => {
    if (!Object.hasOwn(after, key)) return false
    if (isDeepStrictEqual(before[key], after[key])) return true
    if (key.startsWith('_')) return false
    const field = registry.fields(resolved).find((field) => field.name === key)
    return !!field && isCustomTextChange(before[key], after[key], field.typeDef, registry)
  })
}

export function replaceUnique(text: string, search: string, replacement: string) {
  const index = text.indexOf(search)
  if (index < 0 || text.indexOf(search, index + 1) >= 0)
    throw new Error(
      'The text to replace is missing or appears more than once. Specify a unique passage.',
    )
  return text.slice(0, index) + replacement + text.slice(index + search.length)
}

export function editRichText(
  value: Json,
  search: string,
  replacement: string,
  target: RichTextTarget,
  registry: SchemaRegistry,
): z.infer<typeof contentNode>[] {
  const stored = z.array(contentNode).parse(value)
  const markdown = serialize(stored, target, registry)
  const edited = replaceUnique(markdown, search, replacement)
  if (edited === markdown) return stored
  if (stored.length > 1) {
    for (const [index, block] of stored.entries()) {
      if (block._type !== 'block' || block.listItem) continue
      const passage = serialize([block], target, registry)
      if (!passage || passage.includes('\n')) continue
      const start = markdown.indexOf(passage)
      if (start < 0 || start !== markdown.lastIndexOf(passage)) continue
      const prefix = markdown.slice(0, start)
      const suffix = markdown.slice(start + passage.length)
      if (!edited.startsWith(prefix) || !edited.endsWith(suffix)) continue
      const next = edited.slice(start, edited.length - suffix.length)
      if (next.includes('\n') || next === passage) continue
      const updated = editRichText([block], passage, next, target, registry)
      if (updated.length === 1 && updated[0]._key === block._key)
        return [...stored.slice(0, index), ...updated, ...stored.slice(index + 1)]
    }
  }
  const { schema, ...deserialize } = conversionOptions(target, registry)
  const { schema: _schema, ...serialization } = serializationOptions(target, registry)
  let safe = false
  const blocks = z.array(contentNode).parse(
    applyMarkdownEdit(stored, edited, {
      schema,
      serialize: serialization,
      deserialize: {
        ...deserialize,
        onDegradation: (report) => {
          if (report.degradations.length)
            throw new Error(
              'This rich-text edit would lose formatting. Use a narrower edit or append new content.',
            )
        },
      },
      onReconciliation: (report) => {
        safe =
          report.keyMatching === 'performed' &&
          !report.keyFallbacks.length &&
          !report.renamedKeys.length
      },
    }),
  )
  if (!safe)
    throw new Error('This edit could not preserve content identity safely. Try a smaller edit.')
  for (const block of stored) {
    if (block._type === 'block') continue
    const next = blocks.find((item) => item._key === block._key)
    if (isDeepStrictEqual(next, block)) continue
    const member = registry.members(target.schema).find((member) => member.name === block._type)
    if (!next || !member || !isCustomTextChange(block, next, member.typeDef, registry))
      throw new Error(
        'This text edit would change a custom object’s structure or reference. Use a field-level change.',
      )
  }
  const knownKeys = new Set(
    stored.filter((block) => block._type !== 'block').map((block) => block._key),
  )
  if (
    blocks.some((block) => isObject(block) && block._type !== 'block' && !knownKeys.has(block._key))
  )
    throw new Error('Append new rich objects separately so they can be mapped against the schema.')
  return blocks
}
