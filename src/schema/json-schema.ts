import type { TypeDefinition } from './descriptor'

/** The subset of JSON Schema (draft 2020-12 and draft 7) that maps onto Sanity field types. */
export type JsonSchema = {
  $ref?: string
  $defs?: Record<string, JsonSchema>
  definitions?: Record<string, JsonSchema>
  type?: string | string[]
  title?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  enum?: unknown[]
  const?: unknown
  format?: string
  contentMediaType?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  pattern?: string
}

type Field = Record<string, unknown> & { name: string; type: string }
type Rule = Record<string, (...args: never[]) => Rule>
export type JsonSchemaConversion = {
  types: TypeDefinition[]
  /** The document type the root object became. */
  documentType: string
  /** Fields that convert but that Vellum can't fill from Markdown yet. */
  unmapped: string[]
}

const namePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const richTextMediaTypes = new Set(['text/markdown', 'text/html'])
const longTextLength = 200

/**
 * Converts a JSON Schema object into Studio type definitions. Zod schemas convert via
 * `z.toJSONSchema(schema)`.
 *
 * Strings with `format: "markdown"` or `contentMediaType: "text/markdown"` become Portable
 * Text. Arrays of objects become arrays of named object types; `anyOf` items become one member
 * each, named by their `title` or a `const` `type` property.
 */
export function typesFromJsonSchema(input: object, name?: string): JsonSchemaConversion {
  const root = input as JsonSchema
  const unmapped: string[] = []
  const resolve = (schema: JsonSchema, seen = new Set<string>()): JsonSchema => {
    if (!schema.$ref) return unwrapNullable(schema)
    const match = /^#\/(\$defs|definitions)\/(.+)$/.exec(schema.$ref)
    if (!match) throw new Error(`Only local $refs are supported, not ${schema.$ref}.`)
    if (seen.has(schema.$ref)) throw new Error(`Recursive $ref ${schema.$ref} is not supported.`)
    const target = (match[1] === '$defs' ? root.$defs : root.definitions)?.[match[2]]
    if (!target) throw new Error(`Missing definition for ${schema.$ref}.`)
    const { $ref: _ref, ...rest } = schema
    return resolve({ ...target, ...rest }, new Set([...seen, schema.$ref]))
  }

  function objectFields(schema: JsonSchema, path: string): Field[] {
    const required = new Set(schema.required ?? [])
    return Object.entries(schema.properties ?? {}).flatMap(([key, value]) => {
      const fieldPath = path ? `${path}.${key}` : key
      if (!namePattern.test(key)) {
        unmapped.push(`${fieldPath} (not a valid Sanity field name)`)
        return []
      }
      const field = convert(resolve(value), key, fieldPath)
      if (!field) return []
      const rules = [...(required.has(key) ? ['required'] : []), ...constraints(resolve(value))]
      return [{ ...field, ...(rules.length ? { validation: chain(rules) } : {}) }]
    })
  }

  function convert(schema: JsonSchema, name: string, path: string): Field | undefined {
    const base = {
      name,
      ...(schema.title ? { title: schema.title } : {}),
      ...(schema.description ? { description: schema.description } : {}),
    }
    const choices = schema.enum ?? (schema.const !== undefined ? [schema.const] : undefined)
    if (choices?.every((choice) => typeof choice === 'string'))
      return { ...base, type: 'string', options: { list: choices } }
    switch (typeOf(schema)) {
      case 'string':
        if (schema.format === 'markdown' || richTextMediaTypes.has(schema.contentMediaType ?? ''))
          return { ...base, type: 'array', of: [{ type: 'block' }] }
        if (schema.format === 'date') return { ...base, type: 'date' }
        if (schema.format === 'date-time') return { ...base, type: 'datetime' }
        if (schema.format === 'uri' || schema.format === 'url') return { ...base, type: 'url' }
        if (schema.format === 'email') return { ...base, type: 'email' }
        return {
          ...base,
          type: (schema.maxLength ?? 0) > longTextLength ? 'text' : 'string',
        }
      case 'number':
      case 'integer':
        return { ...base, type: 'number' }
      case 'boolean':
        return { ...base, type: 'boolean' }
      case 'object':
        unmapped.push(`${path} (nested object; only arrays of objects are filled)`)
        return { ...base, type: 'object', fields: objectFields(schema, path) }
      case 'array': {
        const items = resolve(schema.items ?? {})
        const variants = (items.anyOf ?? items.oneOf)?.map((variant) => resolve(variant))
        const members = (variants ?? [items]).map((variant, index) =>
          arrayMember(variant, singular(name), index, path),
        )
        if (members.some((member) => !member)) return undefined
        if (members.some((member) => member?.type !== 'object'))
          unmapped.push(`${path} (array of ${typeOf(items) ?? 'mixed'} values)`)
        return { ...base, type: 'array', of: members }
      }
    }
    unmapped.push(`${path} (unsupported type)`)
    return undefined
  }

  function arrayMember(schema: JsonSchema, fallback: string, index: number, path: string) {
    if (typeOf(schema) !== 'object') {
      const primitive = convert(schema, fallback, path)
      if (!primitive || primitive.type === 'array') return undefined
      const { name: _name, ...member } = primitive
      return member
    }
    const discriminator = schema.properties?.type ?? schema.properties?._type
    const constName =
      discriminator && typeof resolve(discriminator).const === 'string'
        ? String(resolve(discriminator).const)
        : undefined
    const memberName = toName(
      constName ?? schema.title ?? (index ? `${fallback}${index + 1}` : fallback),
    )
    const { type: _type, _type: _sanityType, ...properties } = schema.properties ?? {}
    return {
      type: 'object',
      name: memberName,
      title: schema.title ?? memberName,
      fields: objectFields(
        { ...schema, properties: constName ? properties : schema.properties },
        path,
      ),
    }
  }

  const resolved = resolve(root)
  if (typeOf(resolved) !== 'object' || !resolved.properties)
    throw new Error('The JSON Schema must describe an object with properties.')
  const documentType = toName(name ?? resolved.title ?? 'document')
  const document = {
    type: 'document',
    name: documentType,
    title: resolved.title ?? documentType,
    ...(resolved.description ? { description: resolved.description } : {}),
    fields: objectFields(resolved, ''),
  }
  return { types: [document as TypeDefinition], documentType, unmapped }
}

/** True when a pasted value looks like JSON Schema rather than a schema descriptor. */
export function isJsonSchema(value: unknown): value is JsonSchema {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return '$schema' in value || ('properties' in value && !('types' in value))
}

function unwrapNullable(schema: JsonSchema): JsonSchema {
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((type) => type !== 'null')
    return types.length === 1 ? { ...schema, type: types[0] } : schema
  }
  const variants = schema.anyOf ?? schema.oneOf
  const present = variants?.filter((variant) => variant.type !== 'null')
  if (variants && present?.length === 1 && present.length < variants.length) {
    const { anyOf: _anyOf, oneOf: _oneOf, ...rest } = schema
    return { ...present[0], ...rest }
  }
  return schema
}

function typeOf(schema: JsonSchema) {
  if (typeof schema.type === 'string') return schema.type
  if (schema.properties) return 'object'
  if (schema.items) return 'array'
  return undefined
}

function constraints(schema: JsonSchema): string[] {
  const type = typeOf(schema)
  const rules: string[] = []
  const min =
    type === 'array' ? schema.minItems : type === 'string' ? schema.minLength : schema.minimum
  const max =
    type === 'array' ? schema.maxItems : type === 'string' ? schema.maxLength : schema.maximum
  // Zod's .int() adds the safe-integer range as bounds; they constrain nothing real.
  const bounded = (value: unknown): value is number =>
    typeof value === 'number' && Math.abs(value) < Number.MAX_SAFE_INTEGER
  if (bounded(min) && !(type === 'string' && min <= 1)) rules.push(`min:${min}`)
  if (bounded(max)) rules.push(`max:${max}`)
  if (type === 'integer') rules.push('integer')
  return rules
}

function chain(rules: string[]) {
  return (rule: Rule) =>
    rules.reduce((current, spec) => {
      const [method, value] = spec.split(':')
      return value === undefined
        ? current[method]()
        : (current[method] as unknown as (value: number) => Rule)(Number(value))
    }, rule)
}

function toName(value: string) {
  const words = value.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  const camel = words
    .map((word, index) =>
      index ? word[0].toUpperCase() + word.slice(1) : word[0].toLowerCase() + word.slice(1),
    )
    .join('')
  return /^[a-zA-Z_]/.test(camel) ? camel : `_${camel}`
}

function singular(name: string) {
  if (name.endsWith('ies')) return `${name.slice(0, -3)}y`
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1)
  return `${name}Item`
}
