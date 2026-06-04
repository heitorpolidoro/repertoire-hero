import { betterAuth } from 'better-auth'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
})

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  advanced: {
    // Use standard UUIDs so they match the existing uuid columns in Supabase tables.
    generateId: () => crypto.randomUUID(),
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Auto-create a profiles row whenever a Better Auth user is created.
          // profiles.id must equal user.id so foreign-key joins work throughout the app.
          await pool.query(
            `INSERT INTO profiles (id, email, full_name)
             VALUES ($1, $2, $3)
             ON CONFLICT (id) DO NOTHING`,
            [user.id, user.email, user.name ?? null]
          )
        },
      },
    },
  },
})
