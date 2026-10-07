import { NextResponse } from 'next/server'

// Error answers say what failed, never why in database terms (T-0201, L4): the
// detail (table names, constraint names, SQL errors) goes to the server log only.

function detailText(detail: unknown): string {
  if (typeof detail === 'string') return detail
  const message = (detail as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : String(detail)
}

/** Logs `detail` and answers `{ error: what }` with `status` (500 by default). */
export function serverError(what: string, detail: unknown, status = 500): NextResponse {
  console.error(`[api] ${what}:`, detailText(detail))
  return NextResponse.json({ error: what }, { status })
}

/** Logs `detail` and returns the plain message an MCP tool answers with. */
export function toolError(what: string, detail: unknown): { error: string } {
  console.error(`[mcp] ${what}:`, detailText(detail))
  return { error: what }
}
