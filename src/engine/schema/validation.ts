import { createSchemaFromManifestTypes } from '@sanity/schema/_internal'
import { convertToDefinition } from '@sanity/schema-descriptor-utils'
import { validateDocument } from '@sanity/validation'
import { z } from 'zod'
import type { JsonObject } from '../../shared/json'
import type { SchemaNode, SchemaRegistry } from './registry'

const compiledSchemas = new WeakMap<
  SchemaRegistry,
  ReturnType<typeof createSchemaFromManifestTypes>
>()

export function compileValidationSchema(registry: SchemaRegistry) {
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
  const markers = result.markers.map(({ code, level, message, path }) => ({
    code,
    level,
    message,
    path,
  }))
  const format = (marker: (typeof markers)[number]) =>
    `${marker.path.map((segment) => (typeof segment === 'object' && '_key' in segment ? `[_key="${segment._key}"]` : String(segment))).join('.') || document._type}: ${marker.message}`
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
