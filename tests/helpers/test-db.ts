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
 * (auth.users, the anon/authenticated/service_role roles), then the real
 * migration files applied on top. Nothing here talks to a real database.
 */
export async function createTestDb(
  migrations: string[] = ['001_initial.sql', '005_ai_token_usage.sql']
): Promise<PGlite> {
  const pg = new PGlite()
  await pg.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  `)
  for (const file of migrations) {
    await pg.exec(readMigration(file))
  }
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

export async function tokensUsed(pg: PGlite, userId: string, month: string): Promise<number | null> {
  const res = await pg.query<{ tokens_used: number | string }>(
    'SELECT tokens_used FROM public.ai_token_usage WHERE user_id = $1 AND month = $2',
    [userId, month]
  )
  return res.rows[0] ? Number(res.rows[0].tokens_used) : null
}
