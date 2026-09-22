import { z } from 'zod'
import {
  contentNode,
  type PortableTextResult,
  type portableTextRequest,
  type portableTextUpdateRequest,
} from '../../shared/contracts'
import { documentVersion } from '../../shared/json'
import { createSchema, loadSchema } from '../schema/registry'
import { validateMappedDocument } from '../schema/validation'
import { documentPatchRequest, runDocumentPatch } from './patch'
import { buildDocument } from './pipeline'

/** Maps one top-level rich-text field without classifying a document type or routing root fields. */
export async function runPortableText(
  input: z.infer<typeof portableTextRequest> | z.infer<typeof portableTextUpdateRequest>,
  signal: AbortSignal,
): Promise<PortableTextResult> {
  const started = performance.now()
  signal.throwIfAborted()
  const registry = loadSchema(input.schema)
  const target = registry.getTarget(input.target)
  // Validate the selected field and its nested types, without unrelated document requirements.
  const scoped = createSchema({
    ...registry.descriptor,
    types: {
      ...registry.descriptor.types,
      [target.documentType]: {
        extends: 'document',
        fields: [{ name: target.field, typeDef: target.schema }],
      },
    },
  })
  if ('value' in input) {
    const document = { _type: target.documentType, [target.field]: input.value }
    const result = await runDocumentPatch(
      documentPatchRequest.parse({
        source: input.source,
        schema: JSON.stringify(scoped.descriptor),
        threshold: input.threshold,
        document,
        baseVersion: await documentVersion(document),
        sourceBaseline: input.sourceBaseline,
      }),
      signal,
    )
    if (!result.document || !result.sourceBaseline)
      throw new Error('The update returned no Portable Text value.')
    return {
      target: input.target,
      value: z.array(contentNode).parse(result.document[target.field]),
      sourceBaseline: result.sourceBaseline,
      validation: result.validation,
      warnings: result.warnings,
      errors: result.errors,
      trace: result.trace,
      elapsedMs: performance.now() - started,
    }
  }
  const built = await buildDocument(
    { _type: target.documentType, [target.field]: input.source },
    scoped,
    target.documentType,
    input.threshold,
    signal,
  )
  const validation = await validateMappedDocument(built.document, scoped, signal)
  return {
    target: input.target,
    value: z.array(contentNode).parse(built.document[target.field]),
    sourceBaseline: { source: input.source, version: await documentVersion(built.document) },
    validation: { status: validation.status, markers: validation.markers },
    warnings: [...new Set([...built.warnings, ...validation.warnings])],
    errors: validation.errors,
    trace: built.trace,
    elapsedMs: performance.now() - started,
  }
}
