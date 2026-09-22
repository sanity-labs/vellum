import { isDeepStrictEqual } from 'node:util'
import { isObject, type Json, type JsonObject } from '../../shared/json'

type Mutation =
  | { set: Record<string, Json> }
  | { unset: string[] }
  | { insert: { before?: string; after?: string; items: Json[] } }
const keyed = (value: Json[]): value is (JsonObject & { _key: string })[] =>
  value.every((item) => isObject(item) && typeof item._key === 'string')
const keyPath = (path: string, key: string) => `${path}[_key==${JSON.stringify(key)}]`

export function documentDiff(before: JsonObject, after: JsonObject) {
  const patches: Mutation[] = []
  function diff(previous: Json | undefined, next: Json | undefined, path: string) {
    if (isDeepStrictEqual(previous, next)) return
    if (next === undefined) {
      patches.push({ unset: [path] })
      return
    }
    if (Array.isArray(previous) && Array.isArray(next) && keyed(previous) && keyed(next)) {
      const remaining = previous.filter((item) =>
        next.some((candidate) => candidate._key === item._key),
      )
      const old = new Map(previous.map((item) => [item._key, item]))
      for (const item of previous)
        if (!remaining.includes(item)) patches.push({ unset: [keyPath(path, item._key)] })
      next.forEach((item, index) => {
        if (remaining[index]?._key !== item._key) {
          const priorIndex = remaining.findIndex((candidate) => candidate._key === item._key)
          if (priorIndex >= 0) {
            patches.push({ unset: [keyPath(path, item._key)] })
            remaining.splice(priorIndex, 1)
          }
          patches.push({
            insert:
              index === 0
                ? { before: `${path}[0]`, items: [item] }
                : { after: keyPath(path, next[index - 1]._key), items: [item] },
          })
          remaining.splice(index, 0, item)
        } else diff(old.get(item._key), item, keyPath(path, item._key))
      })
      return
    }
    if (isObject(previous) && isObject(next)) {
      for (const key of new Set([...Object.keys(previous), ...Object.keys(next)]))
        diff(previous[key], next[key], `${path}[${JSON.stringify(key)}]`)
      return
    }
    patches.push({ set: { [path]: next } })
  }
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)]))
    diff(before[name], after[name], `[${JSON.stringify(name)}]`)
  return patches
}
