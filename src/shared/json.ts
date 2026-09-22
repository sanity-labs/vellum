import { z } from 'zod'

const patchPath = z
  .array(
    z.union([
      z
        .string()
        .min(1)
        .max(200)
        .refine(
          (name) => !name.startsWith('_') && !['constructor', 'prototype'].includes(name),
          'System fields cannot be edited.',
        ),
      z.strictObject({ _key: z.string().min(1).max(200) }),
    ]),
  )
  .min(1)
  .max(30)
const atPath = { path: patchPath }
const editOperation = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('set'), ...atPath, value: z.json() }),
  z.strictObject({ op: z.literal('unset'), ...atPath }),
  z.strictObject({ op: z.enum(['append', 'prepend']), ...atPath, value: z.json() }),
  z.strictObject({
    op: z.enum(['insertBefore', 'insertAfter']),
    ...atPath,
    anchor: z.string().min(1),
    value: z.json(),
  }),
  z.strictObject({
    op: z.literal('replaceText'),
    ...atPath,
    search: z.string().min(1),
    replacement: z.string(),
  }),
])
export const editOperations = z.array(editOperation).max(32)
export type EditOperation = z.infer<typeof editOperation>
export type PatchPath = z.infer<typeof patchPath>
export type Json = z.infer<ReturnType<typeof z.json>>
export type JsonObject = Record<string, Json>
export const isObject = (value: Json | undefined): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export async function documentVersion(document: JsonObject) {
  function canonical(value: Json): Json {
    if (Array.isArray(value)) return value.map(canonical)
    if (!isObject(value)) return value
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    )
  }
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonical(document))),
  )
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
