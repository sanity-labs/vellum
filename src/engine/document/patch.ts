import { z } from 'zod'
import {
  type DocumentProgress,
  type DocumentRunResult,
  documentRunRequest,
  sourceBaseline,
} from '../../shared/contracts'
import {
  documentVersion,
  type EditOperation,
  editOperations,
  isObject,
  type Json,
  type JsonObject,
  type PatchPath,
} from '../../shared/json'
import type { Binding } from '../mapping/binding'
import { type Block, changedBlocks, spanText, splitBlocks } from '../mapping/blocks'
import { mapAddedBlocks } from '../mapping/map'
import { editRichText, replaceUnique } from '../rich-text/edit'
import { coerceFieldValue, scalarTypes } from '../schema/coerce'
import { createSchema, loadSchema, type SchemaNode, type SchemaRegistry } from '../schema/registry'
import { validateMappedDocument } from '../schema/validation'
import { documentDiff } from './patch-diff'
import { assertKeys, locate, normalizeSlugEdit, valueAt, writeAt } from './patch-path'
import { buildDocument } from './pipeline'
import {
  directObjectSourceEdits,
  directSourceEdits,
  documentLeaves,
  sourceChanges,
} from './source-update'

export const documentPatchRequest = documentRunRequest.omit({ documentType: true }).extend({
  document: z.record(z.string(), z.json()),
  baseVersion: z.string().regex(/^[a-f0-9]{64}$/),
  sourceBaseline: sourceBaseline.optional(),
})
export type DocumentPatchRequest = z.infer<typeof documentPatchRequest>

function pathsOverlap(left: PatchPath, right: PatchPath) {
  return left
    .slice(0, Math.min(left.length, right.length))
    .every((part, index) => JSON.stringify(part) === JSON.stringify(right[index]))
}

function assertNoNewReferences(value: Json) {
  if (Array.isArray(value)) {
    value.forEach(assertNoNewReferences)
    return
  }
  if (!isObject(value)) return
  if (['_ref', '_id', '_rev', '_createdAt', '_updatedAt'].some((key) => Object.hasOwn(value, key)))
    throw new Error(
      'New content cannot invent references or system fields. Resolve those dependencies separately.',
    )
  Object.values(value).forEach(assertNoNewReferences)
}

export async function applyDocumentEdits(
  input: DocumentPatchRequest,
  edits: EditOperation[],
  registry: SchemaRegistry,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  if ((await documentVersion(input.document)) !== input.baseVersion)
    throw new Error('The base document changed. Retry the update against the current result.')
  const type = z.string().parse(input.document._type)
  assertKeys(input.document)
  const operations = editOperations
    .parse(edits)
    .map((edit) => normalizeSlugEdit(input.document, registry, type, edit))
  const targets = operations.map((edit) => locate(input.document, registry, type, edit.path))
  const fields: { name: string; typeDef: SchemaNode }[] = []
  const values: JsonObject = {}
  operations.forEach((edit, index) => {
    if (operations.slice(0, index).some((other) => pathsOverlap(edit.path, other.path)))
      throw new Error('Overlapping edits are ambiguous. Request separate updates.')
    const target = targets[index]
    if (edit.op === 'unset') {
      if (target.value === undefined) throw new Error('The field to remove is already absent.')
      return
    }
    if (edit.op === 'replaceText') {
      if (typeof target.value !== 'string' && !registry.richTextTarget(target.schema, 'edit'))
        throw new Error('Text replacement requires a string or rich-text field.')
      return
    }
    if (
      edit.op === 'set' &&
      target.value !== undefined &&
      typeof target.value === 'object' &&
      target.value !== null
    )
      throw new Error('Edit existing objects and arrays by field or key instead of replacing them.')
    if (edit.op !== 'set' && target.schema.extends !== 'array')
      throw new Error('Insertion requires an array field.')
    if (
      'anchor' in edit &&
      (!Array.isArray(target.value) ||
        !target.value.some((item) => isObject(item) && item._key === edit.anchor))
    )
      throw new Error('The insertion anchor is missing.')
    fields.push({ name: `value${index}`, typeDef: target.schema })
    values[`value${index}`] = edit.value
  })
  let syntheticName = 'vellumPatchValues'
  while (registry.descriptor.types[syntheticName]) syntheticName += '_'
  const valueRegistry = createSchema({
    ...registry.descriptor,
    types: { ...registry.descriptor.types, [syntheticName]: { extends: 'document', fields } },
  })
  const converted = await buildDocument(
    { _type: syntheticName, ...values },
    valueRegistry,
    syntheticName,
    input.threshold,
    signal,
  )
  if (converted.errors.length) throw new Error(converted.errors.join('\n'))
  const document = structuredClone(input.document)
  for (const [index, edit] of operations.entries()) {
    const current = valueAt(document, edit.path)
    const target = targets[index]
    if (edit.op === 'unset') {
      writeAt(document, edit.path)
      continue
    }
    if (edit.op === 'replaceText') {
      const rich = registry.richTextTarget(target.schema, JSON.stringify(edit.path))
      const updated =
        rich && current !== undefined
          ? editRichText(current, edit.search, edit.replacement, rich, registry)
          : replaceUnique(z.string().parse(current), edit.search, edit.replacement)
      writeAt(document, edit.path, updated)
      continue
    }
    const value = converted.document[`value${index}`]
    if (value === undefined)
      throw new Error(
        'The new value could not be mapped without missing data. The update was not applied.',
      )
    assertNoNewReferences(value)
    if (edit.op === 'set') {
      writeAt(document, edit.path, value)
      continue
    }
    if (!Array.isArray(value) || (current !== undefined && !Array.isArray(current)))
      throw new Error('Insertion requires array items.')
    const array = Array.isArray(current) ? [...current] : []
    const indexOfAnchor =
      'anchor' in edit ? array.findIndex((item) => isObject(item) && item._key === edit.anchor) : -1
    const position =
      edit.op === 'prepend'
        ? 0
        : edit.op === 'append'
          ? array.length
          : indexOfAnchor + (edit.op === 'insertAfter' ? 1 : 0)
    array.splice(position, 0, ...value)
    writeAt(document, edit.path, array)
  }
  assertKeys(document)
  signal.throwIfAborted()
  const validation = await validateMappedDocument(document, registry, signal)
  signal.throwIfAborted()
  return {
    document,
    validation,
    warnings: converted.warnings,
    trace: converted.trace,
    edits: operations.length,
  }
}

type FieldValue = { name: string; value: Json }

function remainder(blocks: Block[], excluded: Set<Block>) {
  return blocks
    .filter((block) => !excluded.has(block))
    .map((block) => block.text)
    .join('\n\n')
}

function fieldsHolding(
  block: Block,
  remaining: Block[],
  leaves: ReturnType<typeof documentLeaves>,
  registry: SchemaRegistry,
  type: string,
): FieldValue[] {
  const fields = registry
    .fields(registry.getDocument(type).schema)
    .filter((field) => scalarTypes.has(field.typeDef.extends))
  const supplies = (candidate: Block, schema: SchemaNode, value: Json) =>
    candidate.spans.some(
      (span) => coerceFieldValue(spanText(span, candidate), schema, registry) === value,
    )
  return fields.flatMap((field) => {
    const leaf = leaves.find((leaf) => leaf.path[0] === field.name && leaf.path.length <= 2)
    if (!leaf || !supplies(block, field.typeDef, leaf.value)) return []
    if (remaining.some((other) => supplies(other, field.typeDef, leaf.value))) return []
    return [{ name: field.name, value: leaf.value }]
  })
}

function fieldEdits(document: JsonObject, removed: FieldValue[], added: Binding[]) {
  const edits: EditOperation[] = []
  for (const { name } of removed)
    if (!added.some((next) => next.destination.name === name))
      edits.push({ op: 'unset', path: [name] })
  for (const { destination, value } of added) {
    const replaces = removed.some((old) => old.name === destination.name)
    if (Object.hasOwn(document, destination.name) && !replaces)
      throw new Error('A new source block conflicts with an existing field. Nothing was changed.')
    edits.push({ op: 'set', path: [destination.name], value })
  }
  return edits
}

export async function runDocumentPatch(
  input: DocumentPatchRequest,
  signal: AbortSignal,
  onProgress?: (event: DocumentProgress) => void,
): Promise<DocumentRunResult> {
  const started = performance.now()
  signal.throwIfAborted()
  if ((await documentVersion(input.document)) !== input.baseVersion)
    throw new Error('The base document changed. Retry the update.')
  const registry = loadSchema(input.schema)
  const type = z.string().parse(input.document._type)
  const selected = registry.getDocument(type)
  assertKeys(input.document)
  onProgress?.({ type: 'progress', message: 'Planning changes…' })
  if (input.sourceBaseline && input.sourceBaseline.version !== input.baseVersion)
    throw new Error(
      'The source baseline belongs to a different document. Convert the source again.',
    )
  const changes = input.sourceBaseline
    ? sourceChanges(input.sourceBaseline.source, input.source)
    : undefined
  const previousSource = input.sourceBaseline?.source
  let direct =
    changes && previousSource !== undefined
      ? (directSourceEdits(changes, previousSource, input.document, registry, type) ??
        directObjectSourceEdits(previousSource, input.source, input.document, registry, type))
      : undefined
  const metadataTrace: DocumentRunResult['trace'] = []
  let classificationMs = 0
  if (changes?.length && previousSource !== undefined) {
    const before = splitBlocks(previousSource)
    const after = splitBlocks(input.source)
    const structural = changedBlocks(after, before).length !== changedBlocks(before, after).length
    if (!direct || structural) {
      const classificationStarted = performance.now()
      const mapping = { source: input.source, registry, typeName: type, threshold: input.threshold }
      const added = await mapAddedBlocks(previousSource, mapping, signal)
      classificationMs = performance.now() - classificationStarted
      metadataTrace.push(...added.trace)
      if (added.unresolved.length)
        throw new Error('Some source changes have ambiguous destinations. Nothing was changed.')
      const leaves = documentLeaves(input.document, registry, type)
      const removed = changedBlocks(added.before, added.after).map((block) => ({
        block,
        fields: fieldsHolding(block, added.after, leaves, registry, type),
        mentioned: leaves.some((leaf) => String(leaf.value).includes(block.text)),
      }))
      if (removed.some(({ fields }) => fields.length > 1))
        throw new Error('A removed source block matches several fields. Nothing was changed.')
      const edits = fieldEdits(
        input.document,
        removed.flatMap(({ fields }) => fields),
        added.bindings,
      )
      const dropped = new Set(
        removed.filter(({ fields, mentioned }) => fields.length || !mentioned).map((r) => r.block),
      )
      const claimed = new Set(added.bindings.map(({ block }) => block))
      const beforeRemainder = remainder(added.before, dropped)
      const afterRemainder = remainder(added.after, claimed)
      const remaining = sourceChanges(beforeRemainder, afterRemainder)
      const contentEdits = remaining
        ? (directSourceEdits(remaining, beforeRemainder, input.document, registry, type) ??
          directObjectSourceEdits(beforeRemainder, afterRemainder, input.document, registry, type))
        : undefined
      direct = contentEdits ? [...edits, ...contentEdits] : undefined
    }
  }
  if (!direct)
    throw new Error(
      'These source changes could not be matched safely to existing fields. Nothing was changed. Use Convert to rebuild the result from the revised source.',
    )
  const plannedMs = performance.now() - started - classificationMs
  onProgress?.({
    type: 'progress',
    message: 'Applying changes and checking the document…',
  })
  const applied = await applyDocumentEdits(input, direct, registry, signal)
  const mutations = documentDiff(input.document, applied.document)
  const { schema: _schema, ...documentType } = selected
  return {
    status: 'mapped',
    document: applied.document,
    ...(changes
      ? {
          sourceBaseline: {
            source: input.source,
            version: await documentVersion(applied.document),
          },
        }
      : {}),
    documentType,
    classification: null,
    validation: {
      status: applied.validation.status,
      markers: applied.validation.markers,
    },
    warnings: [...new Set([...applied.warnings, ...applied.validation.warnings])],
    errors: applied.validation.errors,
    trace: [
      ...metadataTrace,
      {
        step: 'Compare source changes',
        engine: 'Code',
        detail: `${changes?.length ?? 0} changed passages.`,
        elapsedMs: plannedMs,
        inputTokens: 0,
        outputTokens: 0,
      },
      ...applied.trace,
    ],
    elapsedMs: performance.now() - started,
    patch: {
      baseVersion: input.baseVersion,
      version: await documentVersion(applied.document),
      edits: mutations.length ? applied.edits : 0,
      mutations,
    },
  }
}
