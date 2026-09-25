import { createSchemaFromManifestTypes } from '@sanity/schema/_internal'
import { convertToDefinition } from '@sanity/schema-descriptor-utils'
import { validateDocument } from '@sanity/validation'
import { z } from 'zod'
import type { JsonObject } from '../../shared/json'
import type { SchemaNode, SchemaRegistry } from './registry'

type CompiledSchema = ReturnType<typeof createSchemaFromManifestTypes>
const compiledSchemas = new WeakMap<SchemaRegistry, CompiledSchema>()

export function compileValidationSchema(registry: SchemaRegistry): CompiledSchema {
  let schema = compiledSchemas.get(registry)
  if (!schema) {
    schema = createSchemaFromManifestTypes(
      convertToDefinition(registry.descriptor, { format: 'manifest' }),
    )
    compiledSchemas.set(registry, schema)
  }
  return schema
}

function unavailableRules(registry: SchemaRegistry, typeName: string) {
  const supported = new Set([
    'required',
    'integer',
    'email',
    'uppercase',
    'lowercase',
    'uniqueItems',
    'reference',
    'assetRequired',
    'enum',
    'minimum',
    'exclusiveMinimum',
    'maximum',
    'exclusiveMaximum',
    'length',
    'precision',
    'regex',
    'uri',
  ])
  const missing = new Set<string>()
  const visited = new WeakSet<SchemaNode>()
  function visit(node: SchemaNode) {
    if (visited.has(node)) return
    visited.add(node)
    for (const group of node.validation ?? [])
      for (const rule of group.rules) if (!supported.has(rule.type)) missing.add(rule.type)
    const parent = registry.descriptor.types[node.extends]
    if (parent) visit(parent)
    for (const member of [...(node.fields ?? []), ...(node.of ?? [])]) {
      const entry = 'name' in member ? member : registry.descriptor.hoisted[member.key]
      if (entry) visit(entry.typeDef)
    }
  }
  visit(registry.getDocument(typeName).schema)
  return [...missing]
}

export async function validateMappedDocument(
  document: JsonObject,
  registry: SchemaRegistry,
  signal: AbortSignal,
) {
  const schema = compileValidationSchema(registry)
  const typeName = z.string().parse(document._type)
  const unavailable = unavailableRules(registry, typeName)
  const result = await validateDocument({
    document: {
      ...document,
      _type: typeName,
      _id: 'drafts.vellum-validation',
      _rev: 'local',
      _createdAt: '1970-01-01T00:00:00.000Z',
      _updatedAt: '1970-01-01T00:00:00.000Z',
    },
    schema,
    signal,
  })
  // A missing value fails every rule on its path; "Required" is the only one worth reading.
  const missing = new Set(
    result.markers
      .filter((marker) => marker.code === 'value.required')
      .map((marker) => JSON.stringify(marker.path)),
  )
  const markers = result.markers
    .filter(
      (marker) => marker.code === 'value.required' || !missing.has(JSON.stringify(marker.path)),
    )
    .map(({ code, level, message, path }) => ({ code, level, message, path }))
  const format = (marker: (typeof markers)[number]) =>
    `${readablePath(document, marker.path) || document._type}: ${marker.message}`
  return {
    status:
      unavailable.length && result.status === 'passed' ? ('notEvaluated' as const) : result.status,
    markers,
    errors: markers.filter((marker) => marker.level === 'error').map(format),
    warnings: [
      ...markers.filter((marker) => marker.level !== 'error').map(format),
      ...(unavailable.length
        ? [`Rules unavailable from this descriptor: ${unavailable.join(', ')}.`]
        : []),
      ...(result.status === 'notEvaluated'
        ? [
            'Some checks could not run. Custom validators and dataset lookups need the original Studio schema and a dataset connection.',
          ]
        : []),
    ],
  }
}

/** Writes `['items', { _key: 'a1b2' }, 'title']` as `items[0].title`, which a reader can find. */
function readablePath(document: JsonObject, path: unknown[]) {
  let value: unknown = document
  let text = ''
  for (const segment of path) {
    if (segment && typeof segment === 'object' && '_key' in segment) {
      const items = Array.isArray(value) ? value : []
      const index = items.findIndex(
        (item) => item && typeof item === 'object' && item._key === segment._key,
      )
      text += index >= 0 ? `[${index}]` : `[_key="${String(segment._key)}"]`
      value = items[index]
    } else if (typeof segment === 'number') {
      text += `[${segment}]`
      value = Array.isArray(value) ? value[segment] : undefined
    } else {
      text += text ? `.${String(segment)}` : String(segment)
      value =
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[String(segment)]
          : undefined
    }
  }
  return text
}
