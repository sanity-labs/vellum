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

export function coerceFieldValue(
  raw: string,
  schema: SchemaNode,
  registry: SchemaRegistry,
): Json | undefined {
  const value = raw.trim()
  switch (schema.extends) {
    case 'boolean':
      return /^(true|false)$/i.test(value) ? value.toLowerCase() === 'true' : undefined
    case 'number':
      return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ? Number(value) : undefined
    case 'slug':
      return slugPattern.test(value) ? value.replace(/^\//, '').replace(/\/$/, '') : undefined
    case 'url':
      return URL.canParse(value) || relativeUrlPattern.test(value) ? value : undefined
    case 'email':
      return emailPattern.test(value) ? value : undefined
    case 'date':
    case 'datetime':
      return Number.isNaN(Date.parse(value)) ? undefined : value
  }
  if (!registry.choices(schema).length) return value
  return matchOption(value, schema)
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
