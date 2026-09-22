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
    }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': new URL('./src/app', import.meta.url).pathname } },
  server: { port: 5173, watch: { ignored: ['**/research/**'] } },
})
