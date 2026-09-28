import type { Json } from '../../shared/json'
import type { SchemaNode, SchemaRegistry } from './registry'

export const scalarTypes = new Set([
  'string',
  'text',
  'url',
  'slug',
  'boolean',
  'number',
  'date',
  'datetime',
  'email',
])

const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const slugPattern = /^\/?[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*\/?$/u
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const relativeUrlPattern = /^[/#?][^\s]*$/
// URL.canParse accepts any scheme, so a labeled line like "Venue: Oslo" would count as a URL.
const webUrlPattern = /^(?:https?:\/\/[^\s]+|mailto:[^\s]+|tel:[^\s]+)$/i
const listSeparator = /[,;]/

/** The item type of an array of plain values, like tags, or undefined for any other array. */
export function listItemSchema(schema: SchemaNode, registry: SchemaRegistry) {
  const resolved = registry.resolveType(schema)
  if (resolved.extends !== 'array') return undefined
  const members = registry.members(resolved)
  if (members.length !== 1 || !scalarTypes.has(members[0].typeDef.extends)) return undefined
  const item = members[0].typeDef
  // Studio keeps predefined values for a list on the array; JSON Schema keeps them on the item.
  const list = resolved.options?.list
  return list?.length && !item.options?.list?.length
    ? { ...item, options: { ...item.options, list } }
    : item
}

export function coerceFieldValue(
  raw: string,
  schema: SchemaNode,
  registry: SchemaRegistry,
): Json | undefined {
  const value = raw.trim()
  const item = listItemSchema(schema, registry)
  if (item) return coerceList(value, item, registry)
  switch (schema.extends) {
    case 'boolean':
      return /^(true|false)$/i.test(value) ? value.toLowerCase() === 'true' : undefined
    case 'number':
      return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ? Number(value) : undefined
    case 'slug':
      return slugPattern.test(value) ? value.replace(/^\//, '').replace(/\/$/, '') : undefined
    case 'url':
      return webUrlPattern.test(value) || relativeUrlPattern.test(value) ? value : undefined
    case 'email':
      return emailPattern.test(value) ? value : undefined
    case 'date':
    case 'datetime':
      return Number.isNaN(Date.parse(value)) ? undefined : value
  }
  if (!registry.choices(schema).length) return value
  return matchOption(value, schema)
}

/** A list is one line of values split on commas or semicolons, each one valid for the item type. */
function coerceList(value: string, item: SchemaNode, registry: SchemaRegistry) {
  if (value.includes('\n')) return undefined
  const parts = value
    .split(listSeparator)
    .map((part) => part.trim())
    .filter(Boolean)
  const items = parts.map((part) => coerceFieldValue(part, item, registry))
  return items.length && !items.includes(undefined) ? (items as Json[]) : undefined
}

function matchOption(value: string, schema: SchemaNode): Json | undefined {
  const matches = (schema.options?.list ?? []).flatMap((option) => {
    if (typeof option === 'string') return normalize(option) === normalize(value) ? [option] : []
    if (!option || typeof option !== 'object' || Array.isArray(option)) return []
    const labels = [option.value, option.title].filter((label) => typeof label === 'string')
    return labels.some((label) => normalize(label) === normalize(value)) ? [option.value] : []
  })
  return matches.length === 1 ? matches[0] : undefined
}
