import { isObject, type Json, type JsonObject } from '../../shared/json'
import { convert } from '../rich-text/convert'
import type { SchemaNode, SchemaRegistry } from '../schema/registry'

const excludedTypes = new Set([
  'reference',
  'crossDatasetReference',
  'globalDocumentReference',
  'image',
  'file',
])
const stringTypes = new Set(['string', 'text', 'url', 'date', 'datetime', 'email'])
const maxDepth = 30

export function materializeDocument(
  input: JsonObject,
  registry: SchemaRegistry,
  documentType: string,
  convertRichText: typeof convert = convert,
) {
  const warnings: string[] = []
  const errors: string[] = []
  let richTextCount = 0

  function visit(
    value: Json,
    inputSchema: SchemaNode,
    path: string,
    typeName = '',
    depth = 0,
  ): Json | undefined {
    if (value === null || (typeof value === 'string' && !value.trim())) return undefined
    if (depth > maxDepth) {
      errors.push(`${path}: content nesting is too deep.`)
      return undefined
    }
    const schema = registry.resolveType(inputSchema)
    if (excludedTypes.has(schema.extends)) {
      warnings.push(`${path}: needs an existing ${schema.extends}; proposed value was omitted.`)
      return undefined
    }
    const richText = registry.richTextTarget(schema, path)
    if (richText) {
      if (typeof value !== 'string') {
        errors.push(`${path}: expected Markdown for this rich text field.`)
        return undefined
      }
      const converted = convertRichText(value, richText, registry)
      richTextCount++
      warnings.push(...converted.warnings.map((warning) => `${path}: ${warning}`))
      return converted.blocks
    }
    if (schema.extends === 'slug') {
      if (typeof value !== 'string') {
        errors.push(`${path}: expected a nonempty slug string.`)
        return undefined
      }
      return { _type: 'slug', current: value }
    }
    if (schema.extends === 'array') return visitArray(value, schema, path, depth)
    if (
      stringTypes.has(schema.extends) ||
      schema.extends === 'number' ||
      schema.extends === 'boolean'
    )
      return visitScalar(value, schema, path)
    return visitObject(value, schema, path, typeName, depth)
  }

  function visitScalar(value: Json, schema: SchemaNode, path: string) {
    const expected = stringTypes.has(schema.extends) ? 'string' : schema.extends
    if (typeof value === expected) return value
    errors.push(`${path}: expected a ${expected}.`)
    return undefined
  }

  function visitArray(value: Json, schema: SchemaNode, path: string, depth: number) {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected an array.`)
      return undefined
    }
    const members = registry.members(schema)
    return value.flatMap((item, index) => {
      const object = item && typeof item === 'object' && !Array.isArray(item) ? item : undefined
      const member = members.find((candidate) =>
        object
          ? candidate.name === object._type
          : candidate.typeDef.extends === typeof item ||
            (typeof item === 'string' && stringTypes.has(candidate.typeDef.extends)),
      )
      if (!member) {
        errors.push(`${path}[${index}]: unknown section or array item type.`)
        return []
      }
      const mapped = visit(
        item,
        member.typeDef,
        `${path}[${index}]`,
        object ? member.name : '',
        depth + 1,
      )
      if (mapped === undefined) return []
      return [
        mapped && typeof mapped === 'object' && !Array.isArray(mapped)
          ? { ...mapped, _key: crypto.randomUUID() }
          : mapped,
      ]
    })
  }

  function visitObject(
    value: Json,
    schema: SchemaNode,
    path: string,
    typeName: string,
    depth: number,
  ) {
    if (!isObject(value)) {
      errors.push(`${path}: expected an object.`)
      return undefined
    }
    const fields = registry.fields(schema)
    for (const name of Object.keys(value)) {
      if (name === '_type' && typeName) continue
      if (!fields.some((field) => field.name === name))
        errors.push(`${path}.${name}: field is not in the schema.`)
    }
    if (typeName && value._type !== typeName) errors.push(`${path}: expected type ${typeName}.`)
    const entries = fields.flatMap((field) => {
      if (!Object.hasOwn(value, field.name)) return []
      const mapped = visit(value[field.name], field.typeDef, `${path}.${field.name}`, '', depth + 1)
      return mapped === undefined ? [] : [[field.name, mapped] satisfies [string, Json]]
    })
    return {
      ...Object.fromEntries(entries),
      ...(typeName ? { _type: typeName } : {}),
    }
  }

  const document = visit(
    input,
    registry.getDocument(documentType).schema,
    documentType,
    documentType,
  )
  if (!document || typeof document !== 'object' || Array.isArray(document))
    throw new Error('The mapped document is invalid.')
  return { document, warnings, errors, richTextCount }
}
