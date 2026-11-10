import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// Fontsource lists a woff fallback beside every woff2 slice; every browser the site supports reads
// woff2, so dropping the fallback halves the published fonts.
function woff2Only(): Plugin {
  return {
    name: 'woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!/@fontsource[\\/].+\.css$/.test(id)) return
      return code.replace(/,\s*url\([^)]+\.woff\)\s*format\(['"]woff['"]\)/g, '')
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [woff2Only(), react()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
