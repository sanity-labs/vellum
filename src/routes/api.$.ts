import { createFileRoute } from '@tanstack/react-router'
import { handleApiRequest } from '../api/http'

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleApiRequest(request),
      POST: ({ request }) => handleApiRequest(request),
    },
  },
})
