/**
 * RH-202 — `migrations/0032_subscriptions.sql`, executed in a throwaway schema
 * that carries only the `profiles` table it references, and rolled back by a
 * sentinel error (the same shape as `canonicalTuningsMigration.db.test.ts`).
 *
 * The migration is resolved by its name suffix, never by its prefix, so a
 * renumber on landing does not break the test.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTransaction, type Queryable } from '@/lib/db'
import { migrationSqlBySuffix } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
const ROLLBACK = 'RH-202 migration scenario rollback'

function token(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

interface ColumnRow {
  column_name: string
  data_type: string
  is_nullable: string
}

interface InsertOutcome {
  label: string
  ok: boolean
  code: string | null
}

interface Outcomes {
  columns: ColumnRow[]
  foreignTable: string | null
  uniqueOnUserId: boolean
  inserts: InsertOutcome[]
  defaults: { plan: string; status: string; provider: string; cancel_at_period_end: boolean } | null
}

const outcomes: Outcomes = {
  columns: [],
  foreignTable: null,
  uniqueOnUserId: false,
  inserts: [],
  defaults: null,
}

/**
 * Runs `fn` against a fresh throwaway schema holding only `profiles` and the
 * migrated `subscriptions`, then rolls everything back. A failure inside `fn`
 * aborts its own scenario only, which is why each insert gets one.
 */
async function inScratchSchema(fn: (client: Queryable) => Promise<void>): Promise<void> {
  const schema = `rh202_${token()}`
  const sql = migrationSqlBySuffix('_subscriptions.sql')
  await withTransaction(async (client) => {
    await client.query(`CREATE SCHEMA ${schema}`)
    await client.query(`SET LOCAL search_path = ${schema}, public`)
    await client.query('CREATE TABLE profiles (id uuid PRIMARY KEY)')
    await client.query(sql)
    await fn(client)
    throw new Error(ROLLBACK)
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
  })
}

/** One insert in its own scenario, so a refused row aborts nothing else. */
async function tryInsert(label: string, values: { plan: string; status: string }): Promise<InsertOutcome> {
  let outcome: InsertOutcome = { label, ok: true, code: null }
  try {
    await inScratchSchema(async (client) => {
      const profileId = randomUUID()
      await client.query('INSERT INTO profiles (id) VALUES ($1)', [profileId])
      await client.query('INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, $2, $3)', [
        profileId,
        values.plan,
        values.status,
      ])
    })
  } catch (error) {
    outcome = { label, ok: false, code: (error as { code?: string }).code ?? null }
  }
  return outcome
}

const ALLOWED_PLANS = ['free', 'pro']
const ALLOWED_STATUSES = ['trialing', 'active', 'past_due', 'canceled']

describe.skipIf(!RUN_DB_TESTS)('migration 0032 subscriptions (RH-202)', () => {
  beforeAll(async () => {
    await inScratchSchema(async (client) => {
      const schemaRow = await client.query<{ schema: string }>('SELECT current_schema() AS schema')
      const schema = schemaRow.rows[0].schema

      const columns = await client.query<ColumnRow>(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'subscriptions'
          ORDER BY column_name`,
        [schema],
      )
      outcomes.columns = columns.rows

      const fk = await client.query<{ foreign_table: string }>(
        `SELECT ccu.table_name AS foreign_table
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
          WHERE tc.table_schema = $1 AND tc.table_name = 'subscriptions'
            AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'user_id'`,
        [schema],
      )
      outcomes.foreignTable = fk.rows[0]?.foreign_table ?? null

      const unique = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
          WHERE tc.table_schema = $1 AND tc.table_name = 'subscriptions'
            AND tc.constraint_type = 'UNIQUE' AND kcu.column_name = 'user_id'`,
        [schema],
      )
      outcomes.uniqueOnUserId = (unique.rows[0]?.n ?? 0) > 0

      const defaultsUser = randomUUID()
      await client.query('INSERT INTO profiles (id) VALUES ($1)', [defaultsUser])
      const defaults = await client.query<NonNullable<Outcomes['defaults']>>(
        `INSERT INTO subscriptions (user_id) VALUES ($1)
         RETURNING plan, status, provider, cancel_at_period_end`,
        [defaultsUser],
      )
      outcomes.defaults = defaults.rows[0] ?? null
    })

    for (const plan of ALLOWED_PLANS) {
      outcomes.inserts.push(await tryInsert(`plan:${plan}`, { plan, status: 'active' }))
    }
    for (const status of ALLOWED_STATUSES) {
      outcomes.inserts.push(await tryInsert(`status:${status}`, { plan: 'pro', status }))
    }
    outcomes.inserts.push(await tryInsert('plan:band', { plan: 'band', status: 'active' }))
    outcomes.inserts.push(await tryInsert('status:paused', { plan: 'pro', status: 'paused' }))
  })

  it('creates every column the spec names', () => {
    expect(outcomes.columns.map((c) => c.column_name)).toEqual(
      [
        'cancel_at_period_end',
        'created_at',
        'current_period_ends_at',
        'id',
        'plan',
        'provider',
        'provider_customer_id',
        'provider_subscription_id',
        'status',
        'trial_ends_at',
        'updated_at',
        'user_id',
      ],
    )
  })

  it('makes the period timestamps nullable timestamptz', () => {
    const byName = new Map(outcomes.columns.map((c) => [c.column_name, c]))
    for (const name of ['trial_ends_at', 'current_period_ends_at']) {
      expect(byName.get(name)?.data_type).toBe('timestamp with time zone')
      expect(byName.get(name)?.is_nullable).toBe('YES')
    }
    expect(byName.get('user_id')?.is_nullable).toBe('NO')
  })

  it('references profiles from a unique user_id', () => {
    expect(outcomes.foreignTable).toBe('profiles')
    expect(outcomes.uniqueOnUserId).toBe(true)
  })

  it.each([...ALLOWED_PLANS.map((p) => `plan:${p}`), ...ALLOWED_STATUSES.map((s) => `status:${s}`)])(
    'accepts %s',
    (label) => {
      expect(outcomes.inserts.find((o) => o.label === label)).toEqual({ label, ok: true, code: null })
    },
  )

  it.each(['plan:band', 'status:paused'])('rejects %s through a CHECK constraint', (label) => {
    // 23514 = check_violation
    expect(outcomes.inserts.find((o) => o.label === label)).toEqual({ label, ok: false, code: '23514' })
  })

  it('defaults a bare row to the free plan, active, on the mock provider', () => {
    expect(outcomes.defaults).toEqual({
      plan: 'free',
      status: 'active',
      provider: 'mock',
      cancel_at_period_end: false,
    })
  })
})
