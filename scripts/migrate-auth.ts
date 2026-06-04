import { createClient } from '@supabase/supabase-js'
import { Pool } from 'pg'
import { randomUUID } from 'crypto'

// Reads existing users from Supabase auth.users and inserts them into
// Better Auth tables. Idempotent: skips users that already exist.

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const databaseUrl = process.env.DATABASE_URL

  if (!supabaseUrl || !serviceRoleKey || !databaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or DATABASE_URL')
  }

  // Supabase admin client — reads from auth.users
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Direct PostgreSQL connection — writes to Better Auth tables
  const pool = new Pool({ connectionString: databaseUrl })

  console.log('Fetching users from Supabase auth.users...')
  const { data: authUsers, error } = await supabase.auth.admin.listUsers()
  if (error) throw new Error(`Failed to list Supabase users: ${error.message}`)

  console.log(`Found ${authUsers.users.length} user(s). Starting migration...`)

  for (const authUser of authUsers.users) {
    // Cast to access encrypted_password which is an admin-only field not typed
    // in the public @supabase/supabase-js User type.
    const supabaseUser = authUser as typeof authUser & { encrypted_password?: string }

    const client = await pool.connect()
    try {
      // Check if user already exists in Better Auth
      const existing = await client.query(
        `SELECT id FROM "user" WHERE id = $1`,
        [supabaseUser.id]
      )

      if (existing.rows.length > 0) {
        console.log(`  - ${supabaseUser.email} -- already migrated, skipping.`)
        continue
      }

      await client.query('BEGIN')

      // Insert into Better Auth "user" table
      await client.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          supabaseUser.id,
          supabaseUser.user_metadata?.full_name ?? supabaseUser.email?.split('@')[0] ?? 'User',
          supabaseUser.email,
          supabaseUser.email_confirmed_at != null,
          supabaseUser.created_at ?? new Date().toISOString(),
          supabaseUser.updated_at ?? new Date().toISOString(),
        ]
      )

      // Insert credential account (email/password) into Better Auth "account" table.
      // Supabase stores bcrypt hash in encrypted_password — Better Auth uses the same algorithm,
      // so users keep their existing passwords without needing a reset.
      if (supabaseUser.encrypted_password) {
        await client.query(
          `INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
           VALUES ($1, $2, 'credential', $3, $4, $5, $6)`,
          [
            randomUUID(),
            supabaseUser.email,
            supabaseUser.id,
            supabaseUser.encrypted_password,
            supabaseUser.created_at ?? new Date().toISOString(),
            supabaseUser.updated_at ?? new Date().toISOString(),
          ]
        )
      }

      await client.query('COMMIT')
      console.log(`  + ${supabaseUser.email} -- migrated.`)
    } catch (err) {
      await client.query('ROLLBACK')
      console.error(`  x ${supabaseUser.email} -- failed:`, err)
      throw err
    } finally {
      client.release()
    }
  }

  await pool.end()
  console.log('Migration complete.')
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
