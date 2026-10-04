// Reading every row of a query that can grow past what Supabase returns at once.
// PostgREST caps every select at the project's max-rows (1000 by default) and cuts
// the rest silently, so any read that decides what may be written must page.

/** Rows asked for per page. */
export const PAGE_SIZE = 1000

/** A stop for a query that never ends (a bug, not data): 10,000 pages. */
const MAX_PAGES = 10_000

type PageResult<T, E> = { data: T[] | null; error: E | null }

/**
 * Calls `page(from, to)` (a query with a stable `order` and `.range(from, to)`)
 * until a page comes back empty, and returns every row. Each next page starts
 * after the rows actually received, so a server cap smaller than PAGE_SIZE is
 * also handled. The first error stops it.
 */
export async function readAllPages<T, E>(
  page: (from: number, to: number) => PromiseLike<PageResult<T, E>>
): Promise<{ data: T[]; error: null } | { data: null; error: E }> {
  const rows: T[] = []
  for (let n = 0; n < MAX_PAGES; n++) {
    const { data, error } = await page(rows.length, rows.length + PAGE_SIZE - 1)
    if (error) return { data: null, error }
    if (!data || data.length === 0) return { data: rows, error: null }
    rows.push(...data)
  }
  throw new Error(`readAllPages: more than ${MAX_PAGES} pages`)
}

/** Splits rows into chunks, for writes that should not send thousands of rows at once. */
export function chunks<T>(rows: T[], size = 500): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}
