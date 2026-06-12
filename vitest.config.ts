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

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./src/lib/__tests__/setup.ts'],
    coverage: {
      exclude: [
        '**/node_modules/**',
        '**/.next/**',
        '**/coverage/**',
        'src/app/**',
        'src/lib/supabase/**',
        'src/lib/spotify*.ts',
        'src/lib/mongodb.ts',
        'src/lib/logger.ts',
        'src/store/**',
        'src/components/**',
        'src/types/**',
        '**/*.config.*',
        '**/*.d.ts',
        'src/lib/__tests__/**',
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})


