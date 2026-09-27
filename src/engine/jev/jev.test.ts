import { afterEach, expect, test, vi } from 'vitest'
import { classifierEndpoint } from './jev'

afterEach(() => {
  vi.unstubAllEnvs()
})

test('Jev is reached through TypeSafe with only a TypeSafe key', () => {
  vi.stubEnv('TYPESAFE_API_KEY', 'typesafe-key')
  expect(classifierEndpoint()).toEqual({
    url: 'https://api.typesafe.ai/v1/systemone',
    key: 'typesafe-key',
  })
})

test('an OpenRouter key routes Jev through OpenRouter, even next to a TypeSafe key', () => {
  vi.stubEnv('TYPESAFE_API_KEY', 'typesafe-key')
  vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-key')
  expect(classifierEndpoint()).toEqual({
    url: 'https://openrouter.ai/api/v1/systemone',
    key: 'openrouter-key',
  })
})

test('without a key there is no classifier', () => {
  vi.stubEnv('TYPESAFE_API_KEY', '')
  expect(classifierEndpoint()).toBeUndefined()
})
