import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations')

export function readMigration(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
}

/**
 * In-memory Postgres (PGlite) with the bits of Supabase the migrations expect
 * (auth.users, the anon/authenticated/service_role roles, and Supabase's default
 * grants: every new public table and function is granted to all three roles),
 * then the real migration files applied on top. Nothing here talks to a real
 * database.
 */
export async function createTestDb(
  migrations: string[] = ['001_initial.sql', '005_ai_token_usage.sql']
): Promise<PGlite> {
  const pg = await createSupabaseLikeDb()
  for (const file of migrations) {
    await pg.exec(readMigration(file))
  }
  return pg
}

/**
 * Same, but built the way PRODUCTION really is: production-schema.sql (a
 * snapshot of the live subscriptions/usage tables, policies, functions and the
 * signup trigger, which differ from 001_initial.sql) followed by the migrations
 * that do match production. See supabase/PRODUCTION_DRIFT.md.
 */
export async function createProductionLikeDb(
  migrations: string[] = [
    '002_sync.sql',
    '003_mcp_tokens.sql',
    '004_mcp_token_expiry.sql',
    '005_ai_token_usage.sql',
  ]
): Promise<PGlite> {
  const pg = await createSupabaseLikeDb()
  await pg.exec(readFileSync(join(__dirname, 'production-schema.sql'), 'utf8'))
  for (const file of migrations) {
    await pg.exec(readMigration(file))
  }
  return pg
}

async function createSupabaseLikeDb(): Promise<PGlite> {
  const pg = new PGlite()
  // supabase_auth_admin owns auth.users and is the role that inserts the row
  // when someone signs up, as on Supabase.
  await pg.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE supabase_auth_admin NOLOGIN;
    CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    ALTER TABLE auth.users OWNER TO supabase_auth_admin;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  `)
  return pg
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`

/**
 * The small slice of the supabase-js client the API routes use
 * (from().select().eq().maybeSingle()/single() and rpc()), backed by PGlite so
 * the routes run against the real table and SQL function from the migration.
 */
/**
 * Like Supabase, every select returns at most `maxRows` rows (PostgREST max-rows,
 * 1000 by default) and silently drops the rest, so tests catch unpaged reads.
 */
export function fakeSupabase(pg: PGlite, { maxRows = 1000 }: { maxRows?: number } = {}): SupabaseClient {
  const client = {
    from(table: string) {
      const target = `public.${ident(table)}`
      let mode: 'select' | 'delete' | 'insert' | 'upsert' = 'select'
      let columns = '*'
      let rows: Record<string, unknown>[] = []
      let onConflict = ''
      let ignoreDuplicates = false
      const filters: { col: string; op: '=' | '<' | 'NOT LIKE' | 'IN'; value: unknown }[] = []
      let orderBy = ''
      let limit: number | null = null
      let offset = 0

      const where = (offset = 0) => {
        const parts = filters.map((f, i) =>
          f.op === 'IN' ? `${ident(f.col)} = ANY($${i + 1 + offset})` : `${ident(f.col)} ${f.op} $${i + 1 + offset}`
        )
        return parts.length ? ` WHERE ${parts.join(' AND ')}` : ''
      }
      const params = () => filters.map(f => f.value)

      const execute = async (): Promise<{ data: unknown; error: { message: string; code?: string } | null }> => {
        try {
          if (mode === 'select') {
            const res = await pg.query(
              `SELECT ${columns} FROM ${target}${where()}${orderBy} LIMIT ${Math.min(limit ?? maxRows, maxRows)} OFFSET ${offset}`,
              params()
            )
            return { data: res.rows, error: null }
          }
          if (mode === 'delete') {
            await pg.query(`DELETE FROM ${target}${where()}`, params())
            return { data: null, error: null }
          }
          // insert / upsert: one statement per row keeps the SQL simple.
          await pg.exec('BEGIN')
          try {
            for (const row of rows) {
              const cols = Object.keys(row)
              const values = cols.map((_, i) => `$${i + 1}`).join(', ')
              let sql = `INSERT INTO ${target} (${cols.map(ident).join(', ')}) VALUES (${values})`
              if (mode === 'upsert') {
                const keys = onConflict.split(',').map(c => c.trim())
                const updates = cols.filter(c => !keys.includes(c)).map(c => `${ident(c)} = EXCLUDED.${ident(c)}`)
                sql += ` ON CONFLICT (${keys.map(ident).join(', ')}) DO ${updates.length && !ignoreDuplicates ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`
              }
              await pg.query(sql, cols.map(c => row[c]))
            }
            await pg.exec('COMMIT')
          } catch (err) {
            await pg.exec('ROLLBACK')
            throw err
          }
          return { data: null, error: null }
        } catch (err) {
          return { data: null, error: { message: (err as Error).message, code: (err as { code?: string }).code } }
        }
      }

      const first = async () => {
        limit = 1
        const res = await execute()
        return { data: Array.isArray(res.data) ? (res.data[0] ?? null) : null, error: res.error }
      }

      const query = {
        select(cols = '*') {
          columns = cols
          return query
        },
        delete() {
          mode = 'delete'
          return query
        },
        insert(data: Record<string, unknown> | Record<string, unknown>[]) {
          mode = 'insert'
          rows = Array.isArray(data) ? data : [data]
          return query
        },
        upsert(data: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
          mode = 'upsert'
          rows = Array.isArray(data) ? data : [data]
          onConflict = options?.onConflict ?? ''
          ignoreDuplicates = options?.ignoreDuplicates === true
          return query
        },
        eq(col: string, value: unknown) {
          filters.push({ col, op: '=', value })
          return query
        },
        lt(col: string, value: unknown) {
          filters.push({ col, op: '<', value })
          return query
        },
        in(col: string, values: unknown[]) {
          filters.push({ col, op: 'IN', value: values })
          return query
        },
        not(col: string, operator: string, value: unknown) {
          if (operator !== 'like') throw new Error(`fakeSupabase: not(${operator}) is not supported`)
          filters.push({ col, op: 'NOT LIKE', value })
          return query
        },
        order(col: string, options?: { ascending?: boolean }) {
          const dir = options?.ascending === false ? 'DESC' : 'ASC'
          orderBy = orderBy ? `${orderBy}, ${ident(col)} ${dir}` : ` ORDER BY ${ident(col)} ${dir}`
          return query
        },
        limit(n: number) {
          limit = n
          return query
        },
        range(from: number, to: number) {
          offset = from
          limit = to - from + 1
          return query
        },
        maybeSingle: first,
        single: first,
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return execute().then(resolve, reject)
        },
      }
      return query
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      try {
        const names = Object.keys(args)
        const res = await pg.query<{ result: unknown }>(
          `SELECT public.${ident(fn)}(${names.map((n, i) => `${ident(n)} => $${i + 1}`).join(', ')}) AS result`,
          names.map(n => args[n])
        )
        return { data: res.rows[0]?.result ?? null, error: null }
      } catch (err) {
        return { data: null, error: { message: (err as Error).message } }
      }
    },
  }
  return client as unknown as SupabaseClient
}

/** Runs one statement as the given Supabase role, then switches back. */
export async function queryAs<T>(
  pg: PGlite,
  role: string,
  sql: string,
  params: unknown[] = []
) {
  await pg.exec(`SET ROLE ${role}`)
  try {
    return await pg.query<T>(sql, params)
  } finally {
    await pg.exec('RESET ROLE')
  }
}

export async function tokensUsed(pg: PGlite, userId: string, month: string): Promise<number | null> {
  const res = await pg.query<{ tokens_used: number | string }>(
    'SELECT tokens_used FROM public.ai_token_usage WHERE user_id = $1 AND month = $2',
    [userId, month]
  )
  return res.rows[0] ? Number(res.rows[0].tokens_used) : null
}
