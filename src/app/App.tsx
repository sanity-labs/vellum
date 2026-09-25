import { ArrowRight, Check, ChevronDown, Copy, LoaderCircle, RotateCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { DocumentTypeSuggestions } from '@/components/document-type-suggestions'
import { SearchPicker } from '@/components/search-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { TooltipProvider } from '@/components/ui/tooltip'
import pageBuilderSource from '../examples/atlas-brief.md?raw'
import articleSource from '../examples/logo-soup.md?raw'
import mediaLibrarySource from '../examples/media-library-asset-function.md?raw'
import migrationSource from '../examples/migration-launch.md?raw'
import jobPostingSource from '../examples/starters/job-posting.md?raw'
import jsonSchemaExample from '../examples/starters/job-posting.schema.json?raw'
import { compileSchemaCode } from '../schema/code'
import { isJsonSchema, type JsonSchema, typesFromJsonSchema } from '../schema/json-schema'
import { toPlainJson } from '../schema/plain'
import { type SchemaFormat, schemaFormats, starterCode, starters } from '../schema/starters'
import { createVellum, type DocumentOptions } from '../sdk'
import {
  type DocumentRunResult,
  type FieldEvidence,
  type WorkspaceCatalog,
  workspaceCatalog,
} from '../shared/contracts'
import { documentVersion, type JsonObject } from '../shared/json'
import { DocumentPreview } from './DocumentPreview'

async function readResponse<T>(response: Response, schema: z.ZodType<T>) {
  const body: unknown = await response.json()
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body)
    throw new Error(error.success ? error.data.error : 'The request failed. Please try again.')
  }
  return schema.parse(body)
}

function OpenSettings() {
  const { open, isMobile } = useSidebar()
  if (open && !isMobile) return null
  return <SidebarTrigger aria-label="Open settings" title="Open settings" />
}

type Example = { label: string; source: string }

/** Samples written for Sanity's admin schema, the one schema with more than one to try. */
const adminExamples: Example[] = [
  { label: 'Atlas page builder', source: pageBuilderSource },
  { label: 'Logo Soup article', source: articleSource },
  { label: 'Media Library function', source: mediaLibrarySource },
  { label: 'Meridian stress test', source: migrationSource },
]
const samples = new Set([
  ...starters.map((starter) => starter.source),
  ...adminExamples.map((example) => example.source),
])

function ExamplePicker({
  disabled,
  examples,
  onChoose,
}: {
  disabled: boolean
  examples: Example[]
  onChoose: (source: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={disabled}>
          Examples <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        {examples.map((example) => (
          <Button
            key={example.label}
            type="button"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              onChoose(example.source)
              setOpen(false)
            }}
          >
            {example.label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

const defaultStarter = starters[0]

function sanityUrl(placement: 'sidebar' | 'result') {
  const url = new URL('https://www.sanity.io/get-started')
  url.searchParams.set('utm_source', 'vellum')
  url.searchParams.set('utm_medium', 'referral')
  url.searchParams.set('utm_content', placement)
  return url.toString()
}
type SchemaChoice = {
  /** A starter id, `admin` for the bundled schema, or `custom` for a pasted one. */
  id: string
  kind: 'descriptor' | 'json-schema'
  unmapped: string[]
  /** The JSON Schema the types came from, which shapes the plain JSON output. */
  jsonSchema?: JsonSchema
  /** The Zod schema a starter was written in, to check the plain JSON output against. */
  zod?: z.ZodType
}

export function App() {
  const [catalog, setCatalog] = useState<WorkspaceCatalog>()
  const [documentType, setDocumentType] = useState('auto')
  const [source, setSource] = useState(defaultStarter.source)
  const [threshold, setThreshold] = useState(0.7)
  const [result, setResult] = useState<DocumentRunResult>()
  const [activeSchema, setActiveSchema] = useState<string>()
  const [schemaDraft, setSchemaDraft] = useState('')
  const [schemaChoice, setSchemaChoice] = useState<SchemaChoice>({
    id: defaultStarter.id,
    kind: 'descriptor',
    unmapped: [],
  })
  const [schemaFormat, setSchemaFormat] = useState<SchemaFormat>('sanity')
  /** Edited starter code, keyed by `starterId:format`, so switching formats keeps edits. */
  const [schemaEdits, setSchemaEdits] = useState<Record<string, string>>({})
  const [editorDraft, setEditorDraft] = useState('')
  const [editorError, setEditorError] = useState('')
  const [applyingSchema, setApplyingSchema] = useState(false)
  const [running, setRunning] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [previousResult, setPreviousResult] = useState<DocumentRunResult>()
  const resultJson = useMemo(
    () => (result?.document ? JSON.stringify(result.document, null, 2) : ''),
    [result?.document],
  )
  const plain = useMemo(
    () =>
      result?.document
        ? toPlainJson(result.document as JsonObject, schemaChoice.jsonSchema)
        : undefined,
    [result?.document, schemaChoice.jsonSchema],
  )
  const plainJson = useMemo(() => (plain ? JSON.stringify(plain, null, 2) : ''), [plain])
  const zodCheck = useMemo(
    () => (plain && schemaChoice.zod ? schemaChoice.zod.safeParse(plain) : undefined),
    [plain, schemaChoice.zod],
  )
  const resultRef = useRef(result)
  resultRef.current = result
  const [resolvedType, setResolvedType] = useState<{
    name: string
    title: string
  } | null>(null)
  const [progress, setProgress] = useState('')
  const [panel, setPanel] = useState<'schema' | 'code' | null>(null)
  const [tab, setTab] = useState('preview')
  const [inspected, setInspected] = useState<string>()
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const [copied, setCopied] = useState(false)
  const controller = useRef<AbortController | null>(null)
  // Newer schema requests make older responses stale. They aren't aborted: a cancelled upload
  // surfaces as a server error in development, and catalog requests are cheap.
  const catalogRequest = useRef(0)
  const busy = running || applyingSchema
  const currentStarter = starters.find((starter) => starter.id === schemaChoice.id)
  const previewType =
    running && !updating ? resolvedType : result?.status === 'mapped' ? result.documentType : null
  // biome-ignore lint/correctness/useExhaustiveDependencies: load the default starter once
  useEffect(() => {
    void switchStarter(defaultStarter.id, 'sanity')
    return () => {
      controller.current?.abort()
      catalogRequest.current += 1
    }
  }, [])

  async function applySchema(
    schema: string | undefined,
    choice: SchemaChoice,
    next: { source?: string; documentType?: string; draft?: string } = {},
  ) {
    toast.dismiss('schema-error')
    const request = ++catalogRequest.current
    const stale = () => request !== catalogRequest.current
    setApplyingSchema(true)
    try {
      const response = await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema }),
      })
      const nextCatalog = await readResponse(response, workspaceCatalog)
      if (stale()) return
      setCatalog(nextCatalog)
      setPreviousResult(undefined)
      setActiveSchema(schema)
      setSchemaChoice(choice)
      if (next.draft !== undefined) setSchemaDraft(next.draft)
      setDocumentType(next.documentType ?? 'auto')
      setResult(undefined)
      setTab(choice.kind === 'json-schema' ? 'plain' : 'preview')
      setPanel((open) => (open === 'schema' ? null : open))
      if (next.source !== undefined) setSource(next.source)
      if (choice.unmapped.length)
        toast.warning('Some fields can’t be filled from Markdown yet', {
          description: choice.unmapped.join(', '),
          id: 'schema-unmapped',
        })
    } catch (error) {
      if (stale()) return
      toast.error('Unable to load the schema', {
        description: error instanceof Error ? error.message : 'Please try again.',
        id: 'schema-error',
      })
      setPanel('schema')
    } finally {
      if (!stale()) setApplyingSchema(false)
    }
  }

  async function chooseStarter(
    id: string,
    format: SchemaFormat,
    options: { withSource?: boolean; code?: string } = {},
  ) {
    const starter = starters.find((item) => item.id === id)
    if (!starter) return
    const code = options.code ?? schemaEdits[`${id}:${format}`] ?? starterCode(starter, format)
    const schema = compileSchemaCode(format, code)
    const { descriptorFromTypes } = await import('../schema/descriptor')
    const descriptor = await descriptorFromTypes(schema.types)
    await applySchema(
      JSON.stringify(descriptor),
      {
        id,
        kind: format === 'sanity' ? 'descriptor' : 'json-schema',
        unmapped: schema.unmapped,
        jsonSchema: schema.jsonSchema,
        zod: schema.zod,
      },
      {
        source: options.withSource === false ? undefined : starter.source,
        documentType: schema.documentType,
      },
    )
    setSchemaFormat(format)
  }

  async function switchStarter(id: string, format: SchemaFormat, withSource = true) {
    try {
      await chooseStarter(id, format, { withSource })
    } catch (error) {
      setSchemaFormat(schemaFormat)
      toast.error('Unable to load the starter', {
        description: error instanceof Error ? error.message : 'Please try again.',
        id: 'schema-error',
      })
    }
  }

  function openEditor() {
    const starter = starters.find((item) => item.id === schemaChoice.id)
    if (!starter) return
    setEditorDraft(
      schemaEdits[`${starter.id}:${schemaFormat}`] ?? starterCode(starter, schemaFormat),
    )
    setEditorError('')
    setPanel('code')
  }

  async function resetEditor() {
    const starter = starters.find((item) => item.id === schemaChoice.id)
    if (!starter) return
    const key = `${starter.id}:${schemaFormat}`
    const code = starterCode(starter, schemaFormat)
    setEditorDraft(code)
    try {
      await chooseStarter(starter.id, schemaFormat, { withSource: false, code })
      setSchemaEdits(({ [key]: _reset, ...edits }) => edits)
      setEditorError('')
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'The schema could not be compiled.')
    }
  }

  async function applyEditor(code: string) {
    const key = `${schemaChoice.id}:${schemaFormat}`
    try {
      await chooseStarter(schemaChoice.id, schemaFormat, { withSource: false, code })
      setSchemaEdits((edits) => ({ ...edits, [key]: code }))
      setEditorError('')
      setPanel(null)
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'The schema could not be compiled.')
    }
  }

  async function applyPastedSchema(text: string) {
    try {
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        throw new Error('The schema is not valid JSON. Check its commas and brackets.')
      }
      if (!isJsonSchema(raw)) {
        await applySchema(text, { id: 'custom', kind: 'descriptor', unmapped: [] }, { draft: text })
        return
      }
      const conversion = typesFromJsonSchema(raw)
      const { descriptorFromTypes } = await import('../schema/descriptor')
      const descriptor = await descriptorFromTypes(conversion.types)
      await applySchema(
        JSON.stringify(descriptor),
        {
          id: 'custom',
          kind: 'json-schema',
          unmapped: conversion.unmapped,
          jsonSchema: raw,
        },
        { draft: text, documentType: conversion.documentType },
      )
    } catch (error) {
      toast.error('Unable to use this schema', {
        description: error instanceof Error ? error.message : 'Please try again.',
        id: 'schema-error',
      })
    }
  }

  async function convert(typeName = documentType, incremental = false) {
    if (busy || controller.current || !source.trim()) return
    if (incremental && !result?.document) return
    const base = result
    toast.dismiss('conversion-error')
    const abort = new AbortController()
    controller.current = abort
    setRunning(true)
    setUpdating(incremental)
    setResolvedType(null)
    setProgress(incremental ? 'Planning changes…' : 'Reading the schema…')
    if (!incremental) {
      setResult(undefined)
      setPreviousResult(undefined)
    }
    setCopied(false)
    try {
      const vellum = createVellum({ endpoint: '/api', schema: activeSchema })
      const options: DocumentOptions = {
        signal: abort.signal,
        onProgress(event) {
          if (event.type === 'progress') setProgress(event.message)
          if (event.type === 'document-type') setResolvedType(event.documentType)
        },
      }
      const next =
        incremental && base
          ? await vellum.updateDocument({ source, previous: base, threshold }, options)
          : await vellum.convertDocument(
              {
                source,
                ...(typeName !== 'auto' ? { documentType: typeName } : {}),
                threshold,
              },
              options,
            )
      if (incremental) {
        const current = resultRef.current?.document
        if (!current || next.patch?.baseVersion !== (await documentVersion(current)))
          throw new Error(
            'The result changed during this update. Retry against the current document.',
          )
        setPreviousResult(base)
      }
      abort.signal.throwIfAborted()
      setInspected(undefined)
      setResult(next)
    } catch (error) {
      if (!abort.signal.aborted) {
        toast.error(incremental ? 'Update failed' : 'Conversion failed', {
          description: error instanceof Error ? error.message : 'Please try again.',
          id: 'conversion-error',
        })
      }
    } finally {
      setRunning(false)
      setUpdating(false)
      controller.current = null
    }
  }

  /** Selects the block a value was copied from in the source editor. */
  function showInSource(evidence: FieldEvidence) {
    const editor = sourceRef.current
    if (!editor || !evidence.source) return
    const { blockText, text } = evidence.source
    let start = source.indexOf(blockText)
    let length = blockText.length
    if (start < 0) {
      start = source.indexOf(text)
      length = text.length
    }
    if (start < 0) return
    editor.focus()
    editor.setSelectionRange(start, start + length)
    const line = source.slice(0, start).split('\n').length - 1
    const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 20
    editor.scrollTop = Math.max(0, line * lineHeight - editor.clientHeight / 3)
  }

  function download() {
    if (!result?.document) return
    const url = URL.createObjectURL(new Blob([resultJson], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${result.documentType?.name ?? 'document'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function copy() {
    if (!result?.document) return
    try {
      await navigator.clipboard.writeText(tab === 'plain' ? plainJson : resultJson)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('Clipboard access was unavailable', { description: 'Use Download JSON instead.' })
    }
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar aria-label="Conversion settings">
          <SidebarHeader className="settings-header">
            <div className="flex items-center justify-between">
              <h1 className="brand">
                <a href="/">Vellum</a>
              </h1>
              <SidebarTrigger aria-label="Close settings" className="md:hidden" />
            </div>
            <p className="text-xs text-muted-foreground">Text into structure</p>
          </SidebarHeader>
          <SidebarContent className="settings-content">
            <FieldGroup>
              <Field className="schema-setting" data-disabled={busy}>
                <FieldLabel htmlFor="schema-picker">Schema</FieldLabel>
                <SearchPicker
                  id="schema-picker"
                  label="Schema"
                  value={schemaChoice.id}
                  disabled={busy}
                  options={[
                    ...starters.map((starter) => ({
                      value: starter.id,
                      label: starter.title,
                      description: starter.description,
                      group: 'Starters',
                    })),
                    {
                      value: 'admin',
                      label: 'Sanity.io admin schema',
                      description: '134 types, the schema behind sanity.io',
                      group: 'More',
                    },
                    {
                      value: 'custom',
                      label: 'Your own schema…',
                      description: 'Paste JSON Schema, Zod output, or a Sanity descriptor',
                      group: 'More',
                    },
                  ]}
                  onChange={(value) => {
                    if (value === 'custom') setPanel('schema')
                    else if (value === 'admin')
                      void applySchema(
                        undefined,
                        { id: 'admin', kind: 'descriptor', unmapped: [] },
                        samples.has(source) ? { source: adminExamples[0].source } : {},
                      )
                    // Bring the starter's sample along, unless the source is the person's own.
                    else void switchStarter(value, schemaFormat, samples.has(source))
                  }}
                />
                {starters.some((starter) => starter.id === schemaChoice.id) && (
                  <div className="schema-format">
                    <Tabs
                      value={schemaFormat}
                      onValueChange={(value) => {
                        // Radix reports a change on both mousedown and focus; act on it once.
                        if (value === schemaFormat) return
                        setSchemaFormat(value as SchemaFormat)
                        void switchStarter(schemaChoice.id, value as SchemaFormat, false)
                      }}
                    >
                      <TabsList className="w-full">
                        {schemaFormats.map((format) => (
                          <TabsTrigger key={format.value} value={format.value} disabled={busy}>
                            {format.label}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                    <span>
                      <button type="button" className="link-button" onClick={openEditor}>
                        Edit schema
                      </button>
                      {schemaEdits[`${schemaChoice.id}:${schemaFormat}`] !== undefined && (
                        <span className="text-muted-foreground"> · edited</span>
                      )}
                    </span>
                  </div>
                )}
                <Dialog
                  open={panel === 'code'}
                  onOpenChange={(open) => setPanel(open ? 'code' : null)}
                >
                  <DialogContent className="schema-dialog max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>
                        {starters.find((starter) => starter.id === schemaChoice.id)?.title} as{' '}
                        {schemaFormats.find((format) => format.value === schemaFormat)?.label}
                      </DialogTitle>
                      <DialogDescription>
                        {schemaFormat === 'sanity'
                          ? 'A Studio schema type. Vellum compiles it into a schema descriptor in your browser.'
                          : schemaFormat === 'zod'
                            ? 'Vellum reads it through z.toJSONSchema(), then checks the plain JSON output against it.'
                            : 'Starts as what z.toJSONSchema() makes of the Zod version. Mark rich text with "format": "markdown".'}{' '}
                        {schemaFormat !== 'json-schema' &&
                          'It runs as plain JavaScript, so leave out type annotations.'}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="schema-editor">
                      <Textarea
                        aria-label="Schema code"
                        className="schema-code"
                        value={editorDraft}
                        onChange={(event) => setEditorDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
                            void applyEditor(editorDraft)
                        }}
                        spellCheck={false}
                        disabled={busy}
                      />
                      {editorError && (
                        <p className="editor-error" role="alert">
                          {editorError}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          disabled={busy || !editorDraft.trim()}
                          onClick={() => applyEditor(editorDraft)}
                        >
                          {applyingSchema ? 'Compiling…' : 'Apply schema'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={resetEditor}
                        >
                          Reset to starter
                        </Button>
                        <span className="text-xs text-muted-foreground">⌘↵ to apply</span>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
                <p id="schema-count" className="field-help">
                  {schemaChoice.id === 'custom'
                    ? `${schemaChoice.kind === 'json-schema' ? 'From JSON Schema' : 'Pasted descriptor'}, ${catalog?.documents.length ?? 0} document ${catalog?.documents.length === 1 ? 'type' : 'types'}. `
                    : null}
                  {schemaChoice.unmapped.length > 0 &&
                    `Can’t fill yet: ${schemaChoice.unmapped.join(', ')}. `}
                  {schemaChoice.id === 'custom' && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setPanel('schema')}
                    >
                      Edit schema
                    </button>
                  )}
                </p>
                <Dialog
                  open={panel === 'schema'}
                  onOpenChange={(open) => setPanel(open ? 'schema' : null)}
                >
                  <DialogContent className="schema-dialog max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Your own schema</DialogTitle>
                      <DialogDescription>
                        Paste a JSON Schema or a Sanity schema descriptor.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="schema-editor">
                      <Field>
                        <FieldLabel htmlFor="schema">Schema JSON</FieldLabel>
                        <p className="field-help">
                          <strong>JSON Schema:</strong> an object with <code>properties</code>. From
                          Zod, paste the output of <code>z.toJSONSchema(schema)</code>. Mark rich
                          text with <code>format: &quot;markdown&quot;</code>.{' '}
                          <strong>Sanity descriptor:</strong> JSON with a <code>types</code> object,
                          like{' '}
                          <a href={catalog?.source} target="_blank" rel="noreferrer">
                            admin-schema.json
                          </a>
                          .
                        </p>
                        <Textarea
                          id="schema"
                          name="schema"
                          value={schemaDraft}
                          onChange={(e) => {
                            setSchemaDraft(e.target.value)
                          }}
                          maxLength={2_000_000}
                          disabled={busy}
                          spellCheck={false}
                          placeholder={
                            '{ "type": "object", "title": "Job posting", "properties": { "title": { "type": "string" } } }'
                          }
                        />
                      </Field>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          disabled={busy || !schemaDraft.trim()}
                          onClick={() => applyPastedSchema(schemaDraft)}
                        >
                          {applyingSchema ? 'Checking schema…' : 'Use this schema'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setSchemaDraft(jsonSchemaExample)
                            setSource(jobPostingSource)
                          }}
                        >
                          Try a JSON Schema example
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </Field>
              {(catalog?.documents.length ?? 0) > 1 && (
                <Field data-disabled={busy || !catalog}>
                  <FieldLabel htmlFor="target">Document type</FieldLabel>
                  <SearchPicker
                    id="target"
                    label="Document type"
                    value={documentType}
                    disabled={busy || !catalog}
                    placeholder="Loading schema…"
                    options={[
                      { value: 'auto', label: 'Choose automatically' },
                      ...(catalog?.documents.map((item) => ({
                        value: item.name,
                        label: item.title,
                        description: item.name,
                      })) ?? []),
                    ]}
                    onChange={(value) => {
                      setDocumentType(value)
                    }}
                  />
                </Field>
              )}
              <details className="advanced-settings">
                <summary>
                  More options
                  <ChevronDown aria-hidden="true" />
                </summary>
                <FieldGroup className="mt-4">
                  <Field data-disabled={busy}>
                    <FieldLabel htmlFor="threshold">
                      Confidence: {Math.round(threshold * 100)}%
                    </FieldLabel>
                    <input
                      id="threshold"
                      name="threshold"
                      type="range"
                      min="0.5"
                      max="1"
                      step="0.05"
                      value={threshold}
                      disabled={busy}
                      onChange={(event) => {
                        setThreshold(Number(event.target.value))
                      }}
                    />
                    <p className="field-help">
                      Field values and automatic type choices below this confidence are left empty
                      for review.
                    </p>
                  </Field>
                </FieldGroup>
              </details>
            </FieldGroup>
          </SidebarContent>
          <SidebarFooter className="made-by">
            <p className="made-by-title">Made by Sanity</p>
            <p>
              Vellum is an experiment. Sanity is the content platform it maps into: typed schemas,
              validated documents, and an API for every front end.
            </p>
            <a className="made-by-cta" href={sanityUrl('sidebar')} target="_blank" rel="noreferrer">
              Start a free Sanity project <ArrowRight aria-hidden="true" className="size-3.5" />
            </a>
            <a href="https://github.com/sanity-labs/vellum" target="_blank" rel="noreferrer">
              Vellum on GitHub
            </a>
          </SidebarFooter>
          <SidebarRail
            aria-label="Collapse settings"
            title="Collapse settings"
            tabIndex={0}
            className="sidebar-edge hidden md:flex group-data-[collapsible=offcanvas]:hidden"
          />
        </Sidebar>
        <SidebarInset className="workspace-container min-w-0">
          <div className="workspace">
            <div className="workbench">
              <section className="source-panel" aria-labelledby="source-label">
                <div className="panel-header">
                  <div className="flex min-w-0 items-center gap-2">
                    <OpenSettings />
                    <label id="source-label" htmlFor="source">
                      Source
                    </label>
                  </div>
                  {schemaChoice.id === 'admin' ? (
                    <ExamplePicker disabled={busy} examples={adminExamples} onChoose={setSource} />
                  ) : currentStarter ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy || source === currentStarter.source}
                      onClick={() => setSource(currentStarter.source)}
                    >
                      Load sample
                    </Button>
                  ) : null}
                </div>
                <Textarea
                  ref={sourceRef}
                  id="source"
                  name="source"
                  spellCheck={false}
                  value={source}
                  maxLength={40000}
                  disabled={busy}
                  onChange={(e) => {
                    setSource(e.target.value)
                  }}
                  className="source-editor"
                  placeholder="Paste source text to convert, or edit it to update the current result…"
                />
                <div className="panel-footer">
                  {running ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => controller.current?.abort()}
                    >
                      {updating ? 'Stop update' : 'Stop conversion'}
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant={result?.document ? 'outline' : 'default'}
                        title={
                          result?.document
                            ? 'Rebuild from the source and replace the entire result'
                            : 'Map the source into a new document'
                        }
                        onClick={() => convert()}
                        disabled={busy || !catalog || !source.trim()}
                      >
                        {result?.document ? (
                          <>
                            Rebuild document <RotateCw data-icon="inline-end" aria-hidden="true" />
                          </>
                        ) : (
                          <>
                            Create document <ArrowRight data-icon="inline-end" aria-hidden="true" />
                          </>
                        )}
                      </Button>
                      {result?.document && (
                        <Button
                          type="button"
                          disabled={busy || !result.sourceBaseline || !source.trim()}
                          onClick={() => convert(documentType, true)}
                          title="Apply source edits to the existing result"
                        >
                          Apply changes
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="result-panel" aria-label="Document result" aria-busy={running}>
                {previewType && (
                  <header className="document-heading">
                    <h2>{previewType.title}</h2>
                    <code>_type: &quot;{previewType.name}&quot;</code>
                  </header>
                )}
                {running && !updating ? (
                  <>
                    <div className="panel-header streaming-header">
                      <span role="status">
                        <LoaderCircle size={14} className="animate-spin" />
                        {progress}
                      </span>
                    </div>
                    <div className="empty-state">Mapping source to the schema…</div>
                  </>
                ) : result?.document ? (
                  <Tabs value={tab} onValueChange={setTab} className="result-tabs">
                    <div className="panel-header result-toolbar">
                      <TabsList variant="line">
                        <TabsTrigger value="preview">Fields</TabsTrigger>
                        <TabsTrigger value="json">Sanity JSON</TabsTrigger>
                        <TabsTrigger value="plain">Plain JSON</TabsTrigger>
                        <TabsTrigger value="validation">
                          Validation
                          {result.errors.length > 0 && (
                            <>
                              <span
                                aria-hidden="true"
                                className="size-2 shrink-0 rounded-full bg-destructive"
                              />
                              <span className="sr-only">
                                {result.errors.length}{' '}
                                {result.errors.length === 1 ? 'error' : 'errors'}
                              </span>
                            </>
                          )}
                        </TabsTrigger>
                      </TabsList>
                      {(tab === 'json' || tab === 'plain') && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={copy}
                          aria-label={copied ? 'Copied' : 'Copy JSON'}
                          title={copied ? 'Copied' : 'Copy JSON'}
                        >
                          {copied ? <Check /> : <Copy />}
                        </Button>
                      )}
                    </div>
                    <TabsContent value="preview" className="result-content">
                      {result.evidence && (
                        <p className="field-help inspect-hint">
                          Click a field name to see where its value came from, or why it’s empty.
                        </p>
                      )}
                      <DocumentPreview
                        value={result.document}
                        confidence={result.confidence}
                        inspect={
                          result.evidence && {
                            evidence: result.evidence,
                            selected: inspected,
                            onSelect: setInspected,
                            onShowSource: showInSource,
                          }
                        }
                      />
                    </TabsContent>
                    <TabsContent value="json" className="result-content">
                      <pre className="json-view">{resultJson}</pre>
                    </TabsContent>
                    <TabsContent value="plain" className="result-content">
                      {zodCheck && (
                        <div
                          className="zod-check"
                          data-status={zodCheck.success ? 'passed' : 'failed'}
                          role="status"
                        >
                          {zodCheck.success ? (
                            'Passes the Zod schema.'
                          ) : (
                            <>
                              <p>Fails the Zod schema. Nothing was invented to make it pass:</p>
                              <ul>
                                {zodCheck.error.issues.map((issue) => (
                                  <li key={`${issue.path.join('.')}:${issue.message}`}>
                                    <code>{issue.path.join('.') || '(root)'}</code>: {issue.message}
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </div>
                      )}
                      <pre className="json-view">{plainJson}</pre>
                    </TabsContent>
                    <TabsContent value="validation" className="result-content">
                      <div className="validation-content">
                        <p className="text-muted-foreground">
                          {result.errors.length
                            ? `${result.errors.length} ${result.errors.length === 1 ? 'error needs' : 'errors need'} attention before using this document.`
                            : result.validation?.status === 'passed'
                              ? 'Sanity validation passed.'
                              : 'No blocking errors. Review the notes below; some checks may be incomplete.'}
                        </p>
                        {result.errors.length > 0 && (
                          <section aria-labelledby="validation-errors-label">
                            <h3 id="validation-errors-label">Errors</h3>
                            <ul>
                              {result.errors.map((message) => (
                                <li key={message}>{message}</li>
                              ))}
                            </ul>
                          </section>
                        )}
                        {result.warnings.length > 0 && (
                          <section aria-labelledby="validation-notes-label">
                            <h3 id="validation-notes-label">Review notes</h3>
                            <ul>
                              {result.warnings.map((message) => (
                                <li key={message}>{message}</li>
                              ))}
                            </ul>
                          </section>
                        )}
                        {result.confidence && Object.keys(result.confidence).length > 0 && (
                          <section aria-labelledby="field-confidence-label">
                            <h3 id="field-confidence-label">Field confidence</h3>
                            <ul>
                              {Object.entries(result.confidence)
                                .sort((a, b) => a[1] - b[1])
                                .map(([path, score]) => (
                                  <li key={path}>
                                    {path}: {Math.round(score * 100)}%
                                  </li>
                                ))}
                            </ul>
                          </section>
                        )}
                      </div>
                    </TabsContent>
                    <div className="panel-footer result-footer">
                      <span>
                        {updating ? (
                          <span role="status">{progress}</span>
                        ) : (
                          `${result.documentType?.name} in ${(result.elapsedMs / 1000).toFixed(2)}s${result.patch ? `, ${result.patch.edits} ${result.patch.edits === 1 ? 'change' : 'changes'}` : ''}`
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button asChild variant="ghost" size="sm">
                          <a href={sanityUrl('result')} target="_blank" rel="noreferrer">
                            Put this in Sanity{' '}
                            <ArrowRight data-icon="inline-end" aria-hidden="true" />
                          </a>
                        </Button>
                        {previousResult && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setResult(previousResult)
                              setPreviousResult(undefined)
                            }}
                          >
                            Undo update
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy || result.errors.length > 0}
                          onClick={download}
                        >
                          Download JSON
                        </Button>
                      </div>
                    </div>
                  </Tabs>
                ) : (
                  <>
                    <div className="panel-header">Result</div>
                    <div className="empty-state" role="status">
                      {result?.status === 'needs-type' ? (
                        <div className="type-choice">
                          <p>{result.warnings[0]}</p>
                          <DocumentTypeSuggestions
                            suggested={result.documentType}
                            alternatives={result.classification?.alternatives ?? []}
                            disabled={busy || !source.trim()}
                            onChoose={(name) => {
                              setDocumentType(name)
                              void convert(name)
                            }}
                          />
                        </div>
                      ) : (
                        <div className="empty-intro">
                          <p>
                            Click <strong>Create document</strong> to map the source into this
                            schema.
                          </p>
                          <p>
                            Jev, a classifier, only picks which part of the source fills each field.
                            Code copies it. Anything the source doesn’t supply stays empty.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
      <Toaster position="bottom-right" closeButton duration={10000} />
    </TooltipProvider>
  )
}
