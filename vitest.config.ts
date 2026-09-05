import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Manually load .env.local to ensure environment variables are present during testing
const loadEnv = (fileName: string) => {
  try {
    const envPath = path.resolve(__dirname, fileName)
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8')
      content.split('\n').forEach(line => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) return
        const idx = trimmed.indexOf('=')
        if (idx > 0) {
          const key = trimmed.substring(0, idx).trim()
          let val = trimmed.substring(idx + 1).trim()
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.substring(1, val.length - 1)
          }
          process.env[key] = val
        }
      })
    }
  } catch (e) {
    console.error(`Failed to load ${fileName}`, e)
  }
}

loadEnv('.env.local')
loadEnv('.env.development.local')

// CI or local test fallback to Supabase's local port (54322) when no DATABASE_URL is explicitly set
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
}

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./src/lib/__tests__/setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.claude/**',
      '**/.gemini/**',
      '**/e2e/**',
      '**/.next/**',
      '**/postgres-data/**',
    ],
    coverage: {
      // The gated universe: the code that is supposed to be unit-testable.
      // Pages, components, the zustand stores and src/app/api/** route handlers
      // are deliberately outside it — they are verified by Playwright + manual QA.
      include: [
        'src/lib/**/*.ts',
        'src/app/actions/*.ts',
        'src/hooks/**/*.ts',
        'src/proxy.ts',
      ],
      exclude: [
        '**/__tests__/**',
        // better-auth wiring — configuration, not logic; exercised end-to-end by Playwright.
        'src/lib/auth.ts',
        'src/lib/auth-client.ts',
        'src/lib/auth-session.ts',
        // Sentry/console shim.
        'src/lib/logger.ts',
        // Asset-path shim; guarded by src/lib/__tests__/pdfWorkerAsset.test.ts.
        'src/lib/pdfWorker.ts',
        // Needs canvas/Image; verified by e2e + manual QA (see docs/tasks/RH-24-spec.md D4).
        'src/lib/imageCompressor.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 65,
        functions: 78,
        lines: 80,
      },
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})


