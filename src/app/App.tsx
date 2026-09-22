import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileJson,
  LoaderCircle,
  RotateCw,
} from 'lucide-react'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sidebar,
  SidebarContent,
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
import { createVellum, type DocumentOptions } from '../sdk'
import {
  type DocumentRunResult,
  type WorkspaceCatalog,
  workspaceCatalog,
} from '../shared/contracts'
import { documentVersion } from '../shared/json'
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

function ExamplePicker({
  disabled,
  onChoose,
}: {
  disabled: boolean
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
        {[
          { label: 'Atlas page builder', source: pageBuilderSource },
          { label: 'Logo Soup article', source: articleSource },
          { label: 'Media Library function', source: mediaLibrarySource },
          { label: 'Meridian stress test', source: migrationSource },
        ].map((example) => (
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

export function App() {
  const [catalog, setCatalog] = useState<WorkspaceCatalog>()
  const [documentType, setDocumentType] = useState('auto')
  const [source, setSource] = useState(pageBuilderSource)
  const [threshold, setThreshold] = useState(0.7)
  const [result, setResult] = useState<DocumentRunResult>()
  const [activeSchema, setActiveSchema] = useState<string>()
  const [schemaDraft, setSchemaDraft] = useState('')
  const [applyingSchema, setApplyingSchema] = useState(false)
  const [running, setRunning] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [previousResult, setPreviousResult] = useState<DocumentRunResult>()
  const resultJson = useMemo(
    () => (result?.document ? JSON.stringify(result.document, null, 2) : ''),
    [result?.document],
  )
  const resultRef = useRef(result)
  resultRef.current = result
  const [resolvedType, setResolvedType] = useState<{
    name: string
    title: string
  } | null>(null)
  const [progress, setProgress] = useState('')
  const [panel, setPanel] = useState<'schema' | null>(null)
  const [tab, setTab] = useState('preview')
  const [copied, setCopied] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const catalogController = useRef<AbortController | null>(null)
  const busy = running || applyingSchema
  const previewType =
    running && !updating ? resolvedType : result?.status === 'mapped' ? result.documentType : null
  useEffect(() => {
    const abort = new AbortController()
    catalogController.current = abort
    fetch('/api/catalog', { signal: abort.signal })
      .then((response) => readResponse(response, workspaceCatalog))
      .then((next) => {
        if (!abort.signal.aborted) {
          setCatalog(next)
        }
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted)
          toast.error('Unable to load the schema', {
            description: error instanceof Error ? error.message : 'Please try again.',
            id: 'schema-error',
          })
      })
    return () => {
      abort.abort()
      controller.current?.abort()
      catalogController.current?.abort()
    }
  }, [])

  async function applySchema(schema?: string, exampleSource?: string) {
    toast.dismiss('schema-error')
    catalogController.current?.abort()
    const abort = new AbortController()
    catalogController.current = abort
    setApplyingSchema(true)
    try {
      const response = await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema }),
        signal: abort.signal,
      })
      const nextCatalog = await readResponse(response, workspaceCatalog)
      if (abort.signal.aborted) return
      setCatalog(nextCatalog)
      setPreviousResult(undefined)
      setActiveSchema(schema)
      setSchemaDraft(schema ?? '')
      setDocumentType('auto')
      setResult(undefined)
      setPanel(null)
      if (exampleSource !== undefined) {
        setSource(exampleSource)
      }
    } catch (error) {
      if (abort.signal.aborted) return
      toast.error('Unable to load the schema', {
        description: error instanceof Error ? error.message : 'Please try again.',
        id: 'schema-error',
      })
      setPanel('schema')
    } finally {
      setApplyingSchema(false)
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
      await navigator.clipboard.writeText(resultJson)
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
              <Field className="schema-setting">
                <FieldLabel htmlFor="schema-picker">Schema</FieldLabel>
                <Dialog
                  open={panel === 'schema'}
                  onOpenChange={(open) => setPanel(open ? 'schema' : null)}
                >
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      id="schema-picker"
                      variant="ghost"
                      className="schema-summary"
                      aria-describedby="schema-count"
                      disabled={busy}
                    >
                      <FileJson aria-hidden="true" className="text-muted-foreground" />
                      <span className="schema-summary-text">
                        <span>{activeSchema ? 'Custom schema' : 'admin-schema.json'}</span>
                        <span id="schema-count" className="schema-count">
                          {catalog?.documents.length ?? 0} document types
                        </span>
                      </span>
                      <ChevronRight aria-hidden="true" className="text-muted-foreground" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="schema-dialog max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Schema</DialogTitle>
                      <DialogDescription>
                        Use the bundled schema or paste your own.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="schema-editor">
                      <p className="field-help">
                        Using{' '}
                        {activeSchema ? (
                          'your pasted schema'
                        ) : (
                          <a href={catalog?.source} target="_blank" rel="noreferrer">
                            admin-schema.json
                          </a>
                        )}{' '}
                        with {catalog?.documents.length ?? 0} document types.
                      </p>
                      <Field>
                        <FieldLabel htmlFor="schema">Paste a schema descriptor</FieldLabel>
                        <p className="field-help">
                          JSON with a <code>types</code> object and optional <code>hoisted</code>{' '}
                          definitions, like the bundled schema. JavaScript schema files are not
                          supported yet.
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
                            '{ "types": { "page": { "extends": "document", "fields": […] } } }'
                          }
                        />
                      </Field>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          disabled={busy || !schemaDraft.trim()}
                          onClick={() => applySchema(schemaDraft)}
                        >
                          {applyingSchema ? 'Checking schema…' : 'Use this schema'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => applySchema()}
                        >
                          Use bundled schema
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </Field>
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
                  <ExamplePicker
                    disabled={busy}
                    onChoose={(source) => applySchema(undefined, source)}
                  />
                </div>
                <Textarea
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
                        <TabsTrigger value="json">JSON</TabsTrigger>
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
                      {tab === 'json' && (
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
                      <DocumentPreview value={result.document} confidence={result.confidence} />
                    </TabsContent>
                    <TabsContent value="json" className="result-content">
                      <pre className="json-view">{resultJson}</pre>
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
                        'Your structured document will appear here.'
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
