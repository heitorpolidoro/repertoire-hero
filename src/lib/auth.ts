import { betterAuth } from 'better-auth'
import { pool } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { hashPassword, verifyPassword } from '@better-auth/utils/password'
import { randomUUID } from 'crypto'

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  advanced: {
    // Generate proper UUIDs — the DB schema uses uuid columns.
    // Must be a function, so Better Auth generates the ID in JS and inserts it,
    // rather than delegating to the DB (which fails for text-based ids on session/account).
    database: {
      generateId: () => randomUUID(),
    },
  },
  trustedOrigins: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    ...(process.env.NEXT_PUBLIC_APP_URL ? [process.env.NEXT_PUBLIC_APP_URL] : []),
  ],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      const apiKey = process.env.RESEND_API_KEY
      const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev'
      
      if (!apiKey) {
        console.log(`[AUTH] Password reset requested for user: ${user.email}`)
        console.log(`[AUTH] Reset URL: ${url}`)
        return
      }

      try {
        const { Resend } = await import('resend')
        const resend = new Resend(apiKey)
        await resend.emails.send({
          from: fromEmail,
          to: user.email,
          subject: 'Reset your Repertoire Hero password',
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
              <h2 style="color: #059669; margin-top: 0;">Repertoire Hero</h2>
              <p>Hello, ${user.name || 'User'}!</p>
              <p>We received a request to reset your password. Click the button below to choose a new one:</p>
              <div style="margin: 24px 0;">
                <a href="${url}" style="background-color: #059669; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Reset Password</a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
              <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
              <p style="color: #9ca3af; font-size: 12px;">This link will expire shortly.</p>
            </div>
          `
        })
      } catch (error) {
        console.error('Failed to send password reset email:', error)
      }
    },
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
