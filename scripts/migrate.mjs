import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load environment variables
const loadEnv = (fileName) => {
  try {
    const envPath = path.resolve(__dirname, '..', fileName)
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

async function run() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  const client = new pg.Client({ connectionString })
  await client.connect()

  try {
    // Create migrations table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `)

    // Load migrations directory
    const migrationsDir = path.resolve(__dirname, '../migrations')
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

    for (const file of files) {
      const { rows } = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file])
      if (rows.length > 0) {
        console.log(`Skipping migration: ${file} (already executed)`)
        continue
      }

      console.log(`Executing migration: ${file}`)
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      
      // Start transaction
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`Migration successful: ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        console.error(`Migration failed: ${file}`)
        throw err
      }
    }
    console.log('All migrations executed successfully')
  } catch (err) {
    console.error('Migration error:', err)
    process.exit(1)
  } finally {
    await client.end()
  }
}

run()
