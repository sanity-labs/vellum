import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Tests fake TypeSafe's endpoint; a real OpenRouter key in the shell would route around it.
  test: { env: { OPENROUTER_API_KEY: '' } },
  resolve: { alias: { '@': new URL('./src/app', import.meta.url).pathname } },
})
