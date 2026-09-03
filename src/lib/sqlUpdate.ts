/**
 * Builds the dynamic `SET` clause of an UPDATE statement from a partial data
 * object, so a column that was not supplied is left untouched instead of being
 * overwritten with `undefined`.
 *
 * Callers keep ownership of their own tail (`updated_at = now()`, the
 * `WHERE id = $${nextIndex}` clause and any early return), which is why this
 * helper only returns the pieces and never the finished statement.
 */
export function buildUpdateSet(
  data: Record<string, unknown>,
  columns: readonly string[],
  startIndex = 1,
): { setClauses: string[]; values: unknown[]; nextIndex: number } {
  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = startIndex

  for (const column of columns) {
    const value = data[column]
    if (value === undefined) continue
    setClauses.push(`${column} = $${paramIndex++}`)
    values.push(value)
  }

  return { setClauses, values, nextIndex: paramIndex }
}
