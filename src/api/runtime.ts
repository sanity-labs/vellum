import { defineMiddleware } from 'nitro'
import { assertBodySize } from 'nitro/h3'

export default defineMiddleware((event, next) => {
  assertBodySize(event, 3 * 1024 * 1024)
  return next()
})
