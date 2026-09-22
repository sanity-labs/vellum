import { z } from 'zod'
import {
  type EditOperation,
  isObject,
  type Json,
  type JsonObject,
  type PatchPath,
} from '../../shared/json'
import type { SchemaRegistry } from '../schema/registry'

export function locate(
  document: JsonObject,
  registry: SchemaRegistry,
  type: string,
  path: PatchPath,
) {
  let schema = registry.getDocument(type).schema
  let value: Json | undefined = document
  let typeName = type
  for (const part of path) {
    schema = registry.resolveType(schema)
    if (typeof part === 'string') {
      if (!isObject(value))
        throw new Error('The parent object is missing. Add it before editing its fields.')
      const field = registry.fields(schema).find((field) => field.name === part)
      if (!field) throw new Error(`Field ${part} is not in the schema.`)
      schema = field.typeDef
      value = Object.hasOwn(value, part) ? value[part] : undefined
      typeName = ''
      continue
    }
    if (schema.extends !== 'array' || !Array.isArray(value))
      throw new Error('The keyed path is not an array.')
    const matches = value.filter((item) => isObject(item) && item._key === part._key)
    if (matches.length !== 1 || !isObject(matches[0]))
      throw new Error('The array key is missing or ambiguous.')
    const item = matches[0]
    value = item
    const member = registry.members(schema).find((member) => member.name === item._type)
    if (!member) throw new Error('The array item type is not in the schema.')
    schema = member.typeDef
    typeName = member.name
  }
  return { value, schema: registry.resolveType(schema), typeName }
}

export function valueAt(document: JsonObject, path: PatchPath): Json | undefined {
  let value: Json | undefined = document
  for (const part of path) {
    if (typeof part === 'string') value = isObject(value) ? value[part] : undefined
    else
      value = Array.isArray(value)
        ? value.find((item) => isObject(item) && item._key === part._key)
        : undefined
  }
  return value
}

export function writeAt(document: JsonObject, path: PatchPath, value?: Json) {
  const parent = valueAt(document, path.slice(0, -1))
  const last = path.at(-1)
  if (typeof last === 'string' && isObject(parent)) {
    if (value === undefined) delete parent[last]
    else parent[last] = value
    return
  }
  if (last && typeof last !== 'string' && Array.isArray(parent)) {
    const index = parent.findIndex((item) => isObject(item) && item._key === last._key)
    if (index < 0) throw new Error('The array item no longer exists.')
    if (value === undefined) parent.splice(index, 1)
    else parent[index] = value
    return
  }
  throw new Error('The edit target no longer exists.')
}

export function assertKeys(value: Json) {
  if (Array.isArray(value)) {
    const keys = new Set<string>()
    for (const item of value) {
      if (isObject(item)) {
        if (typeof item._key !== 'string' || !item._key || keys.has(item._key))
          throw new Error('Object arrays must have unique keys before incremental updates.')
        keys.add(item._key)
      }
      assertKeys(item)
    }
  } else if (isObject(value)) for (const child of Object.values(value)) assertKeys(child)
}

const slugValue = z.strictObject({ _type: z.literal('slug').optional(), current: z.string() })

export function normalizeSlugEdit(
  document: JsonObject,
  registry: SchemaRegistry,
  type: string,
  edit: EditOperation,
): EditOperation {
  if (edit.op !== 'set') return edit
  if (edit.path.length > 1 && edit.path.at(-1) === 'current') {
    const parentPath = edit.path.slice(0, -1)
    const parent = locate(document, registry, type, parentPath)
    if (
      parent.schema.extends === 'slug' &&
      (parent.value == null || typeof parent.value === 'string')
    )
      return { ...edit, path: parentPath, value: z.string().parse(edit.value) }
  }
  const target = locate(document, registry, type, edit.path)
  if (target.schema.extends !== 'slug') return edit
  const value = typeof edit.value === 'string' ? edit.value : slugValue.parse(edit.value).current
  return { ...edit, value, path: isObject(target.value) ? [...edit.path, 'current'] : edit.path }
}
