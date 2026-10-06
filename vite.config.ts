import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tanstackStart({
      importProtection: { behavior: 'error', client: { files: ['**/engine/**', '**/api/**'] } },
    }),
    nitro({
      vercel: { functions: { maxDuration: 120 } },
      handlers: [{ route: '/api/**', middleware: true, handler: './src/api/runtime.ts' }],
      // First-party RudderStack paths, as on research.sanity.io. Vercel serves these as CDN rewrites.
      routeRules: {
        '/intake/dp/**': { proxy: 'https://sanity-dataplane.rudderstack.com/**' },
        '/intake/api/**': { proxy: 'https://api.rudderstack.com/**' },
        '/intake/cdn/**': { proxy: 'https://cdn.rudderlabs.com/**' },
      },
    }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': new URL('./src/app', import.meta.url).pathname } },
  server: { port: 5173, watch: { ignored: ['**/research/**'] } },
})
