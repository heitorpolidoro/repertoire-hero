import { randomUUID } from 'crypto'
import { query } from '@/lib/db'

class SupabaseMockChain {
  private table: string
  private action: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private actionData: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private conditions: { type: 'eq' | 'in' | 'ilike'; col: string; val: any }[] = []
  private singleResult = false
  private maybeSingleResult = false

  constructor(table: string) {
    this.table = table
  }

  select(fields?: string) {
    if (this.action === 'select') {
      this.action = 'select'
    }
    return this
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insert(data: any) {
    this.action = 'insert'
    this.actionData = data
    return this
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update(data: any) {
    this.action = 'update'
    this.actionData = data
    return this
  }

  delete() {
    this.action = 'delete'
    return this
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upsert(data: any) {
    this.action = 'upsert'
    this.actionData = data
    return this
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eq(col: string, val: any) {
    this.conditions.push({ type: 'eq', col, val })
    return this
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  in(col: string, val: any) {
    this.conditions.push({ type: 'in', col, val })
    return this
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ilike(col: string, val: any) {
    this.conditions.push({ type: 'ilike', col, val })
    return this
  }

  single() {
    this.singleResult = true
    return this
  }

  maybeSingle() {
    this.maybeSingleResult = true
    return this
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    try {
      let sql = ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any[] = []
      let paramIndex = 1

      if (this.action === 'select') {
        sql = `SELECT * FROM "${this.table}"`
      } else if (this.action === 'insert') {
        const isArray = Array.isArray(this.actionData)
        const rows = isArray ? this.actionData : [this.actionData]
        const keys = Object.keys(rows[0])
        const columns = keys.map(k => `"${k}"`).join(', ')
        const valuesClauses = rows.map((row: any) => {
          return '(' + keys.map(k => {
            const val = row[k]
            params.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val)
            return `$${paramIndex++}`
          }).join(', ') + ')'
        }).join(', ')

        sql = `INSERT INTO "${this.table}" (${columns}) VALUES ${valuesClauses} RETURNING *`
      } else if (this.action === 'update') {
        const keys = Object.keys(this.actionData)
        const setClauses = keys.map(k => {
          const val = this.actionData[k]
          params.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val)
          return `"${k}" = $${paramIndex++}`
        }).join(', ')
        sql = `UPDATE "${this.table}" SET ${setClauses}`
      } else if (this.action === 'delete') {
        sql = `DELETE FROM "${this.table}"`
      } else if (this.action === 'upsert') {
        const isArray = Array.isArray(this.actionData)
        const rows = isArray ? this.actionData : [this.actionData]
        const keys = Object.keys(rows[0])
        const columns = keys.map(k => `"${k}"`).join(', ')
        const valuesClauses = rows.map((row: any) => {
          return '(' + keys.map(k => {
            const val = row[k]
            params.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val)
            return `$${paramIndex++}`
          }).join(', ') + ')'
        }).join(', ')

        let conflictTarget = ''
        if (this.table === 'repertoire') {
          const hasUserId = keys.includes('user_id')
          if (hasUserId) {
            conflictTarget = '(user_id, song_id) WHERE user_id IS NOT NULL'
          } else {
            conflictTarget = '(band_id, song_id) WHERE band_id IS NOT NULL'
          }
        } else if (this.table === 'spotify_tokens') {
          conflictTarget = '(user_id)'
        } else {
          conflictTarget = '(id)'
        }

        const updateKeys = keys.filter(k => k !== 'id' && k !== 'user_id' && k !== 'band_id' && k !== 'song_id')
        let updateClause = 'DO NOTHING'
        if (updateKeys.length > 0) {
          updateClause = 'DO UPDATE SET ' + updateKeys.map(k => `"${k}" = EXCLUDED."${k}"`).join(', ')
        }

        sql = `INSERT INTO "${this.table}" (${columns}) VALUES ${valuesClauses} ON CONFLICT ${conflictTarget} ${updateClause} RETURNING *`
      }

      const whereClauses: string[] = []
      for (const cond of this.conditions) {
        if (cond.type === 'eq') {
          if (cond.val === null) {
            whereClauses.push(`"${cond.col}" IS NULL`)
          } else {
            params.push(cond.val)
            whereClauses.push(`"${cond.col}" = $${paramIndex++}`)
          }
        } else if (cond.type === 'in') {
          params.push(cond.val)
          whereClauses.push(`"${cond.col}" = ANY($${paramIndex++})`)
        } else if (cond.type === 'ilike') {
          params.push(cond.val)
          whereClauses.push(`"${cond.col}" ILIKE $${paramIndex++}`)
        }
      }

      if (whereClauses.length > 0) {
        sql += ` WHERE ${whereClauses.join(' AND ')}`
      }

      if (this.action === 'update' || this.action === 'delete') {
        sql += ' RETURNING *'
      }

      const res = await query(sql, params)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any = res.rows

      if (this.singleResult) {
        if (res.rowCount === 0) {
          throw new Error('No rows found')
        }
        data = res.rows[0]
      } else if (this.maybeSingleResult) {
        data = res.rowCount === 0 ? null : res.rows[0]
      }

      const result = { data, error: null }
      return onfulfilled ? onfulfilled(result) : result
    } catch (err: any) {
      const result = { data: null, error: { message: err.message, code: err.code } }
      return onfulfilled ? onfulfilled(result) : result
    }
  }
}

class SupabaseMockClient {
  auth = {
    signInWithPassword: async () => ({ data: { user: {} }, error: null }),
    signOut: async () => ({ error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    admin: {
      createUser: async () => ({ data: { user: { id: randomUUID() } }, error: null }),
      deleteUser: async () => ({ error: null }),
    }
  }

  from(table: string) {
    return new SupabaseMockChain(table)
  }
}

const mockClient = new SupabaseMockClient()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAdminTestClient(): any {
  return mockClient
}

export async function createTestUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  { email, name = 'Test User' }: { email: string; name?: string },
): Promise<string> {
  const userId = randomUUID()
  await query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)', [userId, name, email])
  await query('INSERT INTO profiles (id, email, full_name) VALUES ($1, $2, $3)', [userId, email, name])
  return userId
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function deleteTestUser(admin: any, userId: string): Promise<void> {
  await query('DELETE FROM "user" WHERE id = $1', [userId])
}

export async function createTestUserWithGoTrue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  { email, name = 'Test User', password = 'password123' }: { email: string; name?: string; password?: string },
): Promise<{ userId: string; password: string }> {
  const userId = randomUUID()
  await query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)', [userId, name, email])
  await query('INSERT INTO profiles (id, email, full_name) VALUES ($1, $2, $3)', [userId, email, name])
  return { userId, password }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function deleteTestUserWithGoTrue(admin: any, userId: string): Promise<void> {
  await query('DELETE FROM "user" WHERE id = $1', [userId])
}
