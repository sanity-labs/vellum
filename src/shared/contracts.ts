import { z } from 'zod'

export const contentNode = z
  .object({ _type: z.string(), _key: z.string().min(1) })
  .catchall(z.json())
export type ContentNode = z.infer<typeof contentNode>
export const textBlock = contentNode.extend({
  _type: z.literal('block'),
  style: z.string(),
  children: z.array(
    z.object({
      _type: z.literal('span'),
      _key: z.string(),
      text: z.string(),
      marks: z.array(z.string()),
    }),
  ),
  markDefs: z.array(contentNode),
  listItem: z.string().optional(),
  level: z.number().optional(),
})

const targetSummary = z.object({
  id: z.string(),
  title: z.string(),
  documentType: z.string(),
  field: z.string(),
  styles: z.array(z.string()),
  members: z.array(z.string()),
  annotations: z.array(z.string()),
})
const catalogResponse = z.object({
  targets: z.array(targetSummary),
  typeCount: z.number(),
  source: z.string(),
  providers: z.object({
    jev: z.boolean(),
  }),
})
const documentSummary = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  fields: z.array(
    z.object({ name: z.string(), title: z.string(), type: z.string(), description: z.string() }),
  ),
})
export const schemaInput = z.string().max(2_000_000).optional()
export const workspaceCatalog = catalogResponse.extend({ documents: z.array(documentSummary) })
export type WorkspaceCatalog = z.infer<typeof workspaceCatalog>
export const documentRunRequest = z.strictObject({
  source: z.string().trim().min(1).max(40000),
  schema: schemaInput,
  documentType: z.string().optional(),
  threshold: z.number().min(0).max(1).default(0.7),
})
export type DocumentRunRequest = z.infer<typeof documentRunRequest>
export const sourceBaseline = z.object({
  source: z.string().trim().max(40000),
  version: z.string().regex(/^[a-f0-9]{64}$/),
})
const evidenceOption = z.object({
  /** A span id, or `__none__` for "nothing here supplies this field". */
  id: z.string(),
  text: z.string(),
  probability: z.number(),
})
/** Why a field holds its value, or why it's empty. */
const fieldEvidence = z.object({
  status: z.enum(['filled', 'empty']),
  reason: z.enum(['copied', 'below-threshold', 'none-chosen', 'no-candidates']),
  /** The source block the value was copied from, and the exact text copied. */
  source: z
    .object({ block: z.string(), span: z.string(), blockText: z.string(), text: z.string() })
    .optional(),
  /** The three signals: field → part, part → field, and the pairing check when it was asked. */
  signals: z
    .object({ assigned: z.number(), pointed: z.number(), confirmed: z.number().optional() })
    .optional(),
  /** The answer to "which part of the source supplies this field?", most likely first. */
  options: z.array(evidenceOption).default([]),
})
export type FieldEvidence = z.infer<typeof fieldEvidence>

export const documentRunResponse = z.object({
  sourceBaseline: sourceBaseline.optional(),
  patch: z
    .object({
      baseVersion: z.string(),
      version: z.string(),
      edits: z.number().int().nonnegative(),
      mutations: z.array(z.json()),
    })
    .optional(),
  validation: z
    .object({
      status: z.enum(['passed', 'failed', 'notEvaluated']),
      markers: z.array(
        z.object({
          code: z.string(),
          level: z.enum(['error', 'warning', 'info']),
          message: z.string(),
          path: z.array(z.json()),
        }),
      ),
    })
    .optional(),
  status: z.enum(['mapped', 'needs-type']),
  document: z.record(z.string(), z.json()).nullable(),
  confidence: z.record(z.string(), z.number()).optional(),
  evidence: z.record(z.string(), fieldEvidence).optional(),
  documentType: documentSummary.nullable(),
  classification: z
    .object({
      choice: z.string(),
      confidence: z.number(),
      alternatives: z
        .array(z.object({ name: z.string(), title: z.string(), confidence: z.number() }))
        .default([]),
    })
    .nullable(),
  trace: z.array(
    z.object({
      step: z.string(),
      engine: z.enum(['Code', 'Classifier']),
      detail: z.string(),
      elapsedMs: z.number(),
      inputTokens: z.number().default(0),
      outputTokens: z.number().default(0),
    }),
  ),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  elapsedMs: z.number(),
})
export type DocumentRunResult = z.infer<typeof documentRunResponse>

const documentProgress = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), message: z.string() }),
  z.object({
    type: z.literal('document-type'),
    documentType: documentSummary.pick({ name: true, title: true }),
  }),
])
export type DocumentProgress = z.infer<typeof documentProgress>
export const documentRunEvent = z.union([
  documentProgress,
  z.object({ type: z.literal('complete'), result: documentRunResponse }),
  z.object({ type: z.literal('error'), message: z.string() }),
])
export type DocumentRunEvent = z.infer<typeof documentRunEvent>

export const portableTextRequest = documentRunRequest.omit({ documentType: true }).extend({
  target: z.string().min(1),
})
export const portableTextUpdateRequest = portableTextRequest.extend({
  value: z.array(contentNode),
  sourceBaseline,
})
export const portableTextResponse = documentRunResponse
  .pick({
    sourceBaseline: true,
    validation: true,
    warnings: true,
    errors: true,
    trace: true,
    elapsedMs: true,
  })
  .extend({ value: z.array(contentNode), sourceBaseline, target: z.string() })
export type PortableTextResult = z.infer<typeof portableTextResponse>
