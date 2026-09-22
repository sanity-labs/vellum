import { isDeepStrictEqual } from 'node:util'
import { markdownToPortableText } from '@portabletext/markdown'
import { z } from 'zod'
import { contentNode } from '../../shared/contracts'
import { type EditOperation, isObject, type Json, type PatchPath } from '../../shared/json'
import { conversionOptions } from '../rich-text/convert'
import type { RichTextTarget, SchemaRegistry } from '../schema/registry'

// Annotation keys are local identities too; compare their meaning, not generated IDs.
function comparable(value: Json): Json {
  if (Array.isArray(value)) return value.map(comparable)
  if (!isObject(value)) return value
  const definitions = Array.isArray(value.markDefs) ? value.markDefs.filter(isObject) : []
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => name !== '_key')
      .map(([name, child]) => [
        name,
        name === 'children' && Array.isArray(child)
          ? child.map((span) =>
              isObject(span) && Array.isArray(span.marks)
                ? comparable({
                    ...span,
                    marks: span.marks.map((mark) => {
                      const definition = definitions.find((item) => item._key === mark)
                      return definition ? comparable(definition) : mark
                    }),
                  })
                : comparable(span),
            )
          : comparable(child),
      ]),
  )
}

function sourceBlocks(source: string, target: RichTextTarget, registry: SchemaRegistry) {
  const options = conversionOptions(target, registry)
  let key = 0
  return z.array(contentNode).parse(
    markdownToPortableText(source, {
      ...options,
      keyGenerator: () => `source${key++}`,
      types: {
        ...options.types,
        image: ({ value, context }) => ({
          _type: '__sourceImage',
          _key: context.keyGenerator(),
          src: value.src,
          alt: value.alt,
          ...(value.title ? { title: value.title } : {}),
        }),
      },
    }),
  )
}

function matches(source: Json, stored: Json): boolean {
  if (Array.isArray(source))
    return (
      Array.isArray(stored) &&
      source.length === stored.length &&
      source.every((item, index) => matches(item, stored[index]))
    )
  if (!isObject(source)) return isDeepStrictEqual(source, stored)
  return (
    isObject(stored) &&
    Object.entries(source).every(([name, child]) =>
      Object.hasOwn(stored, name) ? matches(child, stored[name]) : false,
    )
  )
}

function occurrences(value: Json, type: string, projection: Json): number {
  if (Array.isArray(value))
    return value.reduce<number>((count, child) => count + occurrences(child, type, projection), 0)
  if (!isObject(value)) return 0
  return (
    Number(value._type === type && matches(projection, comparable(value))) +
    Object.values(value).reduce<number>(
      (count, child) => count + occurrences(child, type, projection),
      0,
    )
  )
}

function textEdits(
  before: Json,
  after: Json,
  stored: Json,
  path: PatchPath,
): EditOperation[] | undefined {
  if (isDeepStrictEqual(comparable(before), comparable(after))) return []
  if (typeof before === 'string' && typeof after === 'string' && before === stored)
    return [{ op: 'set', path, value: after }]
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(stored)) {
    if (before.length !== after.length || before.length !== stored.length) return undefined
    const edits: EditOperation[] = []
    for (const [index, item] of before.entries()) {
      if (isDeepStrictEqual(comparable(item), comparable(after[index]))) continue
      const actual = stored[index]
      if (!isObject(actual) || typeof actual._key !== 'string') return undefined
      const changes = textEdits(item, after[index], actual, [...path, { _key: actual._key }])
      if (!changes) return undefined
      edits.push(...changes)
    }
    return edits
  }
  if (!isObject(before) || !isObject(after) || !isObject(stored)) return undefined
  const names = Object.keys(before).filter((name) => name !== '_key')
  if (
    !isDeepStrictEqual(
      names.sort(),
      Object.keys(after)
        .filter((name) => name !== '_key')
        .sort(),
    )
  )
    return undefined
  const edits: EditOperation[] = []
  for (const name of names) {
    if (isDeepStrictEqual(comparable(before[name]), comparable(after[name]))) continue
    if (name.startsWith('_') || name === 'marks' || name === 'markDefs') return undefined
    const changes = textEdits(before[name], after[name], stored[name], [...path, name])
    if (!changes) return undefined
    edits.push(...changes)
  }
  return edits
}

export function sourceObjectEdits(
  beforeSource: string,
  afterSource: string,
  document: Json,
  fields: { path: PatchPath; target: RichTextTarget; blocks: z.infer<typeof contentNode>[] }[],
  registry: SchemaRegistry,
): EditOperation[] | undefined {
  const plans: EditOperation[][] = []
  for (const field of fields) {
    const before = sourceBlocks(beforeSource, field.target, registry)
    const after = sourceBlocks(afterSource, field.target, registry)
    if (before.length !== after.length) continue
    const edits: EditOperation[] = []
    let safe = true
    for (const [index, block] of before.entries()) {
      const next = after[index]
      if (isDeepStrictEqual(comparable(block), comparable(next))) continue
      if (block._type === 'block' || block._type !== next._type) {
        safe = false
        break
      }
      const image = block._type === '__sourceImage'
      if (image && (!block.alt || block.src !== next.src || block.title !== next.title)) {
        safe = false
        break
      }
      const projection = image ? { alt: block.alt } : comparable(block)
      const sameSource = before.filter((other) =>
        image
          ? other._type === '__sourceImage' && other.alt === block.alt
          : matches(projection, comparable(other)),
      )
      const candidates = fields.flatMap((candidateField) =>
        candidateField.blocks.flatMap((stored) => {
          if (!matches(projection, comparable(stored))) return []
          const member = registry
            .members(candidateField.target.schema)
            .find((member) => member.name === stored._type)
          if (image && (!member || registry.resolveType(member.typeDef).extends !== 'image'))
            return []
          return [{ field: candidateField, stored }]
        }),
      )
      const candidate = candidates[0]
      if (sameSource.length !== 1 || candidates.length !== 1 || candidate?.field !== field) {
        safe = false
        break
      }
      const { stored } = candidate
      if (occurrences(document, stored._type, projection) !== 1) {
        safe = false
        break
      }
      const changes = textEdits(
        image ? { alt: block.alt } : block,
        image ? { alt: next.alt } : next,
        stored,
        [...field.path, { _key: stored._key }],
      )
      if (!changes?.length) {
        safe = false
        break
      }
      edits.push(...changes)
    }
    if (safe && edits.length) plans.push(edits)
  }
  return plans.length === 1 ? plans[0] : undefined
}
