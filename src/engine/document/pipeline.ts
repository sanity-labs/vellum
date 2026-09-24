import type {
  DocumentProgress,
  DocumentRunRequest,
  DocumentRunResult,
} from '../../shared/contracts'
import { documentVersion } from '../../shared/json'
import { classifyDocument } from '../mapping/classify-document'
import { type MappingInput, mapBlocks } from '../mapping/map'
import {
  planRichContent,
  type RichContentPlan,
  resolveRichContent,
} from '../rich-text/custom-content'
import { loadSchema, type SchemaRegistry } from '../schema/registry'
import { compileValidationSchema, validateMappedDocument } from '../schema/validation'
import { materializeDocument } from './materialize'

export type Mapper = (
  input: MappingInput,
  signal: AbortSignal,
  onProgress?: (event: DocumentProgress) => void,
) => Promise<{
  document: NonNullable<DocumentRunResult['document']>
  confidence: Record<string, number>
  evidence?: DocumentRunResult['evidence']
  notes: string[]
  trace: DocumentRunResult['trace']
}>

export async function runDocument(
  input: DocumentRunRequest,
  signal: AbortSignal,
  onProgress?: (event: DocumentProgress) => void,
  mapper: Mapper = mapBlocks,
): Promise<DocumentRunResult> {
  const started = performance.now()
  const registry = loadSchema(input.schema)
  if (!registry.documents.length) throw new Error('The schema has no document types.')
  compileValidationSchema(registry)
  const trace: DocumentRunResult['trace'] = []
  let classification: DocumentRunResult['classification'] = null
  let typeName = input.documentType
  if (!typeName) {
    onProgress?.({ type: 'progress', message: 'Choosing a document type…' })
    const selected = await classifyDocument(input.source, registry, signal)
    classification = {
      choice: selected.choice,
      confidence: selected.confidence,
      alternatives: selected.alternatives,
    }
    trace.push(selected.trace)
    const candidate = registry.documents.find((document) => document.name === selected.choice)
    if (!candidate || selected.confidence < input.threshold)
      return {
        status: 'needs-type',
        document: null,
        documentType: candidate ?? null,
        classification,
        trace,
        warnings: [
          candidate
            ? `Suggested ${candidate.title} with ${Math.round(selected.confidence * 100)}% confidence. Choose a type to continue.`
            : 'No document type matched confidently. Choose a type or try another schema.',
        ],
        errors: [],
        elapsedMs: performance.now() - started,
      }
    typeName = selected.choice
  }
  const selected = registry.getDocument(typeName)
  onProgress?.({
    type: 'document-type',
    documentType: { name: selected.name, title: selected.title },
  })
  const mapped = await mapper(
    { source: input.source, registry, typeName, threshold: input.threshold },
    signal,
    onProgress,
  )
  trace.push(...mapped.trace)
  onProgress?.({
    type: 'progress',
    message: 'Converting rich text and checking the document…',
  })
  const materialized = await buildDocument(
    mapped.document,
    registry,
    typeName,
    input.threshold,
    signal,
    onProgress,
  )
  trace.push(...materialized.trace)
  const validationStarted = performance.now()
  const validation = await validateMappedDocument(materialized.document, registry, signal)
  trace.push({
    step: 'Check document',
    engine: 'Code',
    detail: `${materialized.richTextCount} rich text fields converted; checked by @sanity/validation (${validation.status}).`,
    elapsedMs: performance.now() - validationStarted,
    inputTokens: 0,
    outputTokens: 0,
  })
  const { schema: _schema, ...documentType } = selected
  return {
    status: 'mapped',
    document: materialized.document,
    sourceBaseline: {
      source: input.source,
      version: await documentVersion(materialized.document),
    },
    documentType,
    classification,
    confidence: mapped.confidence,
    evidence: mapped.evidence,
    validation: { status: validation.status, markers: validation.markers },
    trace,
    warnings: [...new Set([...mapped.notes, ...materialized.warnings, ...validation.warnings])],
    errors: [...new Set([...materialized.errors, ...validation.errors])],
    elapsedMs: performance.now() - started,
  }
}

export async function buildDocument(
  document: NonNullable<DocumentRunResult['document']>,
  registry: SchemaRegistry,
  typeName: string,
  threshold: number,
  signal: AbortSignal,
  onProgress?: (event: DocumentProgress) => void,
) {
  const conversionStarted = performance.now()
  const plans = new Map<string, RichContentPlan>()
  materializeDocument(document, registry, typeName, (markdown, target) => {
    const plan = planRichContent(markdown, target, registry)
    plans.set(target.id, plan)
    return plan
  })
  if ([...plans.values()].some((plan) => plan.pending.length))
    onProgress?.({
      type: 'progress',
      message: 'Mapping images and custom rich content…',
    })
  const selectionStarted = performance.now()
  const resolved = await resolveRichContent([...plans.values()], threshold, signal)
  const selectionMs = performance.now() - selectionStarted
  const trace = [...resolved.traces]
  const materialized = materializeDocument(document, registry, typeName, (_markdown, target) => {
    const plan = plans.get(target.id)
    if (!plan) throw new Error('Missing rich content conversion plan.')
    return plan
  })
  trace.push({
    step: 'Build document',
    engine: 'Code',
    detail: `${materialized.richTextCount} rich text fields converted.`,
    elapsedMs: performance.now() - conversionStarted - selectionMs,
    inputTokens: 0,
    outputTokens: 0,
  })
  return { ...materialized, trace }
}
