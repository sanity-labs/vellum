import { z } from 'zod'
import type { TypeDefinition } from './descriptor'
import { type JsonSchema, typesFromJsonSchema } from './json-schema'
import * as sanityHelpers from './starters/sanity/define'

export type SchemaFormat = 'sanity' | 'zod' | 'json-schema'
export type CompiledSchema = {
  types: TypeDefinition[]
  documentType: string
  unmapped: string[]
  /** The JSON Schema behind Zod and JSON Schema input, which shapes the plain JSON output. */
  jsonSchema?: JsonSchema
  /** The Zod schema, to check the plain JSON output against. */
  zod?: z.ZodType
}

/**
 * Turns schema source into Studio type definitions. Sanity and Zod source is run as JavaScript
 * in the caller's runtime, with `import` lines replaced by the bindings Vellum provides, so it
 * must be free of TypeScript annotations. Only run code the person running it wrote or can see.
 */
export function compileSchemaCode(format: SchemaFormat, code: string): CompiledSchema {
  if (format === 'json-schema') {
    let raw: unknown
    try {
      raw = JSON.parse(code)
    } catch {
      throw new Error('The JSON Schema is not valid JSON. Check its commas and brackets.')
    }
    if (!raw || typeof raw !== 'object') throw new Error('The JSON Schema must be an object.')
    return { ...typesFromJsonSchema(raw), jsonSchema: raw as JsonSchema }
  }
  if (format === 'zod') {
    const schemas = Object.values(run(code, { z })).filter(
      (value): value is z.ZodType => value instanceof z.ZodType,
    )
    const schema = schemas.at(-1)
    if (!schema)
      throw new Error('Export a Zod object schema, like `export const Post = z.object({…})`.')
    const jsonSchema = z.toJSONSchema(schema) as JsonSchema
    return { ...typesFromJsonSchema(jsonSchema), jsonSchema, zod: schema }
  }
  const types = Object.values(run(code, sanityHelpers)).filter(
    (value): value is TypeDefinition =>
      value !== null && typeof value === 'object' && 'name' in value && 'type' in value,
  )
  const document = types.find((type) => type.type === 'document')
  if (!document)
    throw new Error(
      "Export a document type, like `export const post = defineType({ type: 'document', … })`.",
    )
  return { types, documentType: document.name, unmapped: [] }
}

function run(code: string, bindings: object) {
  const body = code
    .replace(/^\s*import\s[^;\n]*;?\s*$/gm, '')
    .replace(/^export\s+const\s+(\w+)\s*=/gm, 'exports.$1 = ')
  const exports: Record<string, unknown> = {}
  try {
    new Function('exports', ...Object.keys(bindings), body)(exports, ...Object.values(bindings))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      error instanceof SyntaxError
        ? `${message}. The editor runs plain JavaScript, so leave out TypeScript annotations.`
        : message,
    )
  }
  return exports
}
