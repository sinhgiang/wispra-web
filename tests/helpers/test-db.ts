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
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
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
export function fakeSupabase(pg: PGlite): SupabaseClient {
  const client = {
    from(table: string) {
      let columns = '*'
      const filters: [string, unknown][] = []
      const run = async () => {
        try {
          const where = filters.map(([col], i) => `${ident(col)} = $${i + 1}`).join(' AND ')
          const res = await pg.query(
            `SELECT ${columns} FROM public.${ident(table)}${where ? ` WHERE ${where}` : ''} LIMIT 1`,
            filters.map(([, value]) => value)
          )
          return { data: res.rows[0] ?? null, error: null }
        } catch (err) {
          return { data: null, error: { message: (err as Error).message } }
        }
      }
      const query = {
        select(cols: string) {
          columns = cols
          return query
        },
        eq(col: string, value: unknown) {
          filters.push([col, value])
          return query
        },
        maybeSingle: run,
        single: run,
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
