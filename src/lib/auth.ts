import { betterAuth } from 'better-auth'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import { hashPassword, verifyPassword } from '@better-auth/utils/password'

const pool = new Pool({
  connectionString: process.env.BETTER_AUTH_DATABASE_URL ?? process.env.DATABASE_URL!,
})

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  // Use standard UUIDs so they match the existing uuid columns in Supabase tables.
  generateId: 'uuid',
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    password: {
      // New accounts use scrypt (Better Auth default).
      hash: hashPassword,
      // Verify supports both scrypt (new) and bcrypt (migrated GoTrue users).
      verify: async ({ hash, password }) => {
        if (hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
          return bcrypt.compare(password, hash)
        }
        return verifyPassword(hash, password)
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Auto-create a profiles row whenever a Better Auth user is created.
          // profiles.id must equal user.id so foreign-key joins work throughout the app.
          await pool.query(
            `INSERT INTO profiles (id, email, full_name)
             VALUES ($1::uuid, $2, $3)
             ON CONFLICT (id) DO NOTHING`,
            [user.id, user.email, user.name ?? null]
          )
        },
      },
    },
  },
})
