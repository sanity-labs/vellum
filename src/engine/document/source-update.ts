import { cleanupSemantic, makeDiff } from '@sanity/diff-match-patch'
import { z } from 'zod'
import { contentNode } from '../../shared/contracts'
import {
  type EditOperation,
  isObject,
  type Json,
  type JsonObject,
  type PatchPath,
} from '../../shared/json'
import { convert, serialize } from '../rich-text/convert'
import { replaceUnique } from '../rich-text/edit'
import type { RichTextTarget, SchemaNode, SchemaRegistry } from '../schema/registry'
import { sourceObjectEdits } from './source-object-update'

export function sourceChanges(before: string, after: string) {
  const diffs = cleanupSemantic(makeDiff(before, after, { timeout: 0.05 }))
  const unchanged = diffs.reduce((size, [kind, text]) => size + (kind === 0 ? text.length : 0), 0)
  if (unchanged < Math.max(before.length, after.length) / 2) return undefined
  const ranges: { start: number; end: number; nextStart: number; nextEnd: number }[] = []
  let oldOffset = 0
  let newOffset = 0
  for (const [kind, text] of diffs) {
    if (kind !== 0) {
      const start = before.lastIndexOf('\n', Math.max(0, oldOffset - 1)) + 1
      const endAt = before.indexOf('\n', oldOffset + (kind < 0 ? text.length : 0))
      const nextStart = after.lastIndexOf('\n', Math.max(0, newOffset - 1)) + 1
      const nextEndAt = after.indexOf('\n', newOffset + (kind > 0 ? text.length : 0))
      const range = {
        start,
        end: endAt < 0 ? before.length : endAt,
        nextStart,
        nextEnd: nextEndAt < 0 ? after.length : nextEndAt,
      }
      const previous = ranges.at(-1)
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end)
        previous.nextEnd = Math.max(previous.nextEnd, range.nextEnd)
      } else ranges.push(range)
    }
    if (kind <= 0) oldOffset += text.length
    if (kind >= 0) newOffset += text.length
  }
  return ranges.map(({ start, end, nextStart, nextEnd }) => ({
    before: before.slice(start, end),
    after: after.slice(nextStart, nextEnd),
    contextBefore: before.slice(Math.max(0, start - 160), start),
    contextAfter: before.slice(end, end + 160),
  }))
}

type Leaf = {
  path: PatchPath
  name: string
  title: string
  value: string | number | boolean
  rich: boolean
  slug?: boolean
  target?: RichTextTarget
  blocks?: z.infer<typeof contentNode>[]
}
export function documentLeaves(document: JsonObject, registry: SchemaRegistry, type: string) {
  const leaves: Leaf[] = []
  function visit(value: Json, input: SchemaNode, path: PatchPath, name: string) {
    const schema = registry.resolveType(input)
    const rich = registry.richTextTarget(schema, name)
    if (rich && Array.isArray(value)) {
      const blocks = z.array(contentNode).parse(value)
      leaves.push({
        path,
        name,
        title: schema.title ?? name,
        rich: true,
        target: rich,
        blocks,
        value: serialize(blocks, rich, registry),
      })
      return
    }
    if (
      ['reference', 'image', 'file', 'crossDatasetReference', 'globalDocumentReference'].includes(
        schema.extends,
      )
    )
      return
    if (schema.extends === 'slug' && isObject(value) && typeof value.current === 'string') {
      leaves.push({
        path: [...path, 'current'],
        name,
        title: schema.title ?? name,
        value: value.current,
        rich: false,
        slug: true,
      })
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!isObject(item) || typeof item._key !== 'string') continue
        const member = registry.members(schema).find((member) => member.name === item._type)
        if (member) visit(item, member.typeDef, [...path, { _key: item._key }], name)
      }
    } else if (isObject(value)) {
      for (const field of registry.fields(schema))
        if (Object.hasOwn(value, field.name))
          visit(value[field.name], field.typeDef, [...path, field.name], field.name)
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      leaves.push({ path, name, title: schema.title ?? name, value, rich: false })
    }
  }
  visit(document, registry.getDocument(type).schema, [], type)
  return leaves
}

export function directObjectSourceEdits(
  previousSource: string,
  source: string,
  document: JsonObject,
  registry: SchemaRegistry,
  type: string,
) {
  return sourceObjectEdits(
    previousSource,
    source,
    document,
    documentLeaves(document, registry, type).flatMap((leaf) =>
      leaf.target && leaf.blocks
        ? [{ path: leaf.path, target: leaf.target, blocks: leaf.blocks }]
        : [],
    ),
    registry,
  )
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const unique = (text: string, search: string) =>
  search.length > 0 &&
  text.indexOf(search) >= 0 &&
  text.indexOf(search) === text.lastIndexOf(search)

function canonicalPassage(markdown: string, target: RichTextTarget, registry: SchemaRegistry) {
  const converted = convert(markdown, target, registry)
  if (converted.warnings.length || converted.blocks.some((block) => block._type !== 'block'))
    return undefined
  return serialize(converted.blocks, target, registry)
}

export function directSourceEdits(
  changes: NonNullable<ReturnType<typeof sourceChanges>>,
  previousSource: string,
  document: JsonObject,
  registry: SchemaRegistry,
  type: string,
): EditOperation[] | undefined {
  if (!changes.length) return []
  const leaves = documentLeaves(document, registry, type)
  const updates = new Map<Leaf, string | number | boolean>()
  for (const change of changes) {
    if (!unique(previousSource, change.before)) return undefined
    const label = /^([^:\n]{1,80}):[ \t]*(.*)$/.exec(change.before)
    const nextLabel = /^([^:\n]{1,80}):[ \t]*(.*)$/.exec(change.after)
    const heading = /^# +(.+)$/.exec(change.before)
    const nextHeading = /^# +(.+)$/.exec(change.after)
    const before =
      label && nextLabel && label[1] === nextLabel[1]
        ? label[2]
        : heading && nextHeading
          ? heading[1]
          : change.before
    const after =
      label && nextLabel && label[1] === nextLabel[1]
        ? nextLabel[2]
        : heading && nextHeading
          ? nextHeading[1]
          : change.after
    const matches = leaves.flatMap((leaf) => {
      if (!leaf.rich) {
        const search = leaf.slug ? before.replace(/^\//, '') : before
        const replacement = leaf.slug ? after.replace(/^\//, '') : after
        return String(leaf.value) === search &&
          (!label ||
            [leaf.name, leaf.title].some((name) => normalize(name) === normalize(label[1])) ||
            unique(previousSource, before))
          ? [{ leaf, search, replacement }]
          : []
      }
      if (typeof leaf.value !== 'string') return []
      const target = leaf.target
      const customContains = (search: string) =>
        target &&
        leaf.blocks?.some(
          (block) =>
            block._type !== 'block' && serialize([block], target, registry).includes(search),
        )
      if (customContains(change.before)) return []
      if (unique(leaf.value, change.before))
        return [{ leaf, search: change.before, replacement: change.after }]
      if (!leaf.target) return []
      const search = canonicalPassage(change.before, leaf.target, registry)
      if (!search || !unique(leaf.value, search) || customContains(search)) return []
      const replacement = canonicalPassage(change.after, leaf.target, registry)
      return replacement === undefined ? [] : [{ leaf, search, replacement }]
    })
    if (matches.length !== 1) return undefined
    const { leaf, search, replacement } = matches[0]
    const value = updates.get(leaf) ?? leaf.value
    if (leaf.rich && typeof value === 'string')
      updates.set(leaf, replaceUnique(value, search, replacement))
    else if (typeof value === 'string') updates.set(leaf, replacement)
    else if (typeof value === 'boolean' && /^(true|false)$/.test(after))
      updates.set(leaf, after === 'true')
    else if (
      typeof value === 'number' &&
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(after) &&
      Number.isFinite(Number(after))
    )
      updates.set(leaf, Number(after))
    else return undefined
  }
  return [...updates].map(([leaf, value]) =>
    leaf.rich && typeof leaf.value === 'string' && typeof value === 'string'
      ? { op: 'replaceText', path: leaf.path, search: leaf.value, replacement: value }
      : { op: 'set', path: leaf.path, value },
  )
}
