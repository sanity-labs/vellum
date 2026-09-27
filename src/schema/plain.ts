import { portableTextToMarkdown } from '@portabletext/markdown'
import type { JsonSchema } from './json-schema'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/**
 * Projects a Sanity document onto plain JSON, the shape a JSON Schema or Zod consumer expects:
 * no `_key`s or `_type`s, slugs as strings, and rich text as Markdown.
 *
 * With the JSON Schema the document was mapped from, items of a union array get back the
 * `type` discriminator their variant declares. Without it, items of a mixed array keep `_type`.
 */
export function toPlainJson(value: Json, schema?: JsonSchema): Json {
  const resolve = (node: JsonSchema | undefined): JsonSchema | undefined => {
    const match = node?.$ref && /^#\/(\$defs|definitions)\/(.+)$/.exec(node.$ref)
    if (!match) return node
    return resolve((match[1] === '$defs' ? schema?.$defs : schema?.definitions)?.[match[2]])
  }

  function project(value: Json, node: JsonSchema | undefined): Json {
    node = resolve(node)
    if (Array.isArray(value)) {
      if (value.length && value.every(isBlock))
        return portableTextToMarkdown(
          value as unknown as Parameters<typeof portableTextToMarkdown>[0],
        )
      const items = resolve(node?.items)
      const variants = (items?.anyOf ?? items?.oneOf)?.map((variant) => resolve(variant) ?? {})
      const types = new Set(value.map((item) => (isObject(item) ? item._type : undefined)))
      return value.map((item) => {
        if (!isObject(item)) return project(item, items)
        const variant = variants?.find((variant) => discriminator(variant) === item._type)
        if (variant) return { type: item._type, ...(project(item, variant) as object) }
        if (!schema && types.size > 1)
          return { _type: item._type, ...(project(item, undefined) as object) }
        return project(item, items)
      })
    }
    if (!isObject(value)) return value
    if (value._type === 'slug' && typeof value.current === 'string') return value.current
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith('_'))
        .map(([key, item]) => [key, project(item, node?.properties?.[key])]),
    )
  }

  return project(value, schema)
}

function discriminator(variant: JsonSchema) {
  const type = variant.properties?.type
  return typeof type?.const === 'string' ? type.const : undefined
}

function isObject(value: Json): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBlock(value: Json) {
  return isObject(value) && value._type === 'block'
}
