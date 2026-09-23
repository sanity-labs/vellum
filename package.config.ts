import { defineConfig } from '@sanity/pkg-utils'

export default defineConfig({
  tsdoc: {
    rules: {
      'ae-internal-missing-underscore': 'off',
      'ae-missing-release-tag': 'off',
    },
  },
})
