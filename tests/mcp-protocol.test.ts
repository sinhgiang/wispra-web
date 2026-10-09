import { createHash } from 'crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createProductionLikeDb, fakeSupabase, queryAs } from './helpers/test-db'

// T-0258: mcp-handler 2.x (MCP SDK v2). A real MCP client talks to the secret-link route
// end to end: the same 7 tools, the same argument checks, and each link reads only its
// own user's rows.

const USER_A = '00000000-0000-4000-8000-0000000000a1'
const USER_B = '00000000-0000-4000-8000-0000000000b2'
const TOKEN_A = 'link-of-user-a'
const TOKEN_B = 'link-of-user-b'
const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
}))

import { POST, GET } from '@/app/api/mcp/[token]/route'

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

let nextId = 1
async function rpc(token: string, method: string, params: Record<string, unknown> = {}) {
  const res = await POST(
    new NextRequest(`http://localhost/api/mcp/${token}`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    }),
    { params: Promise.resolve({ token }) }
  )
  const text = await res.text()
  // The handler may answer as JSON or as one SSE event; read either.
  const payload = res.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('')
    : text
  return { status: res.status, body: payload ? JSON.parse(payload) : null }
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const { status, body } = await rpc(token, 'tools/call', { name, arguments: args })
  expect(status).toBe(200)
  return body
}

const toolJson = (body: { result: { content: { text: string }[] } }) => JSON.parse(body.result.content[0].text)

describe('remote MCP over mcp-handler 2.x', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createProductionLikeDb(['002_sync.sql', '003_mcp_tokens.sql', '004_mcp_token_expiry.sql'])
    for (const id of [USER_A, USER_B]) {
      await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [id])
    }
    await pg.query('INSERT INTO public.mcp_tokens (user_id, token_hash) VALUES ($1, $2), ($3, $4)', [
      USER_A,
      hash(TOKEN_A),
      USER_B,
      hash(TOKEN_B),
    ])
    await pg.query(
      `INSERT INTO public.synced_history (user_id, id, text, created_at, duration_seconds) VALUES
         ($1, 'h-a', 'note of user A', '2026-10-01T08:00:00Z', 12),
         ($2, 'h-b', 'note of user B', '2026-10-02T08:00:00Z', 30)`,
      [USER_A, USER_B]
    )
  })
  afterAll(() => pg.close())
  beforeEach(() => {
    state.supabase = fakeSupabase(pg)
  })

  it('initializes with the Wispra server name', async () => {
    const { status, body } = await rpc(TOKEN_A, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    })
    expect(status).toBe(200)
    expect(body.result.serverInfo.name).toBe('wispra-mcp')
    expect(body.result.capabilities.tools).toBeDefined()
  })

  it('lists the same 7 tools, with their argument schemas', async () => {
    const { status, body } = await rpc(TOKEN_A, 'tools/list')
    expect(status).toBe(200)
    const tools = body.result.tools as { name: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] } }[]
    expect(tools.map(t => t.name).sort()).toEqual([
      'get_history_entry',
      'get_meeting',
      'get_usage_stats',
      'get_vocabulary',
      'list_meetings',
      'search_history',
      'search_meetings',
    ])
    const byName = Object.fromEntries(tools.map(t => [t.name, t.inputSchema]))
    expect(Object.keys(byName.list_meetings.properties ?? {})).toEqual(['limit'])
    expect(byName.list_meetings.required ?? []).toEqual([])
    expect(byName.get_history_entry.required).toEqual(['id'])
    expect(byName.search_history.required).toEqual(['query'])
  })

  it('a call reads the link owner’s rows', async () => {
    const entry = toolJson(await callTool(TOKEN_A, 'get_history_entry', { id: 'h-a' }))
    expect(entry.text).toBe('note of user A')
    const found = toolJson(await callTool(TOKEN_A, 'search_history', { query: 'note' }))
    expect(JSON.stringify(found)).toContain('note of user A')
    expect(JSON.stringify(found)).not.toContain('note of user B')
  })

  it('user B’s link cannot read user A’s entry', async () => {
    const entry = toolJson(await callTool(TOKEN_B, 'get_history_entry', { id: 'h-a' }))
    expect(entry).toEqual({ error: 'No history entry found with id "h-a".' })
    expect(JSON.stringify(toolJson(await callTool(TOKEN_B, 'search_history', { query: 'user' })))).not.toContain('user A')
  })

  it('rejects bad arguments before the tool runs', async () => {
    const body = await callTool(TOKEN_A, 'list_meetings', { limit: 'ten' })
    const failed = body.error !== undefined || body.result?.isError === true
    expect(failed).toBe(true)
  })

  it('an unknown link is refused with 403 before MCP runs', async () => {
    const { status, body } = await rpc('not-a-real-link', 'tools/list')
    expect(status).toBe(403)
    expect(body.error).toBe('Invalid or revoked connection link')
  })

  it('a GET on a valid link does not open a session stream (stateless)', async () => {
    const res = await GET(new NextRequest(`http://localhost/api/mcp/${TOKEN_A}`, { headers: { accept: 'text/event-stream' } }), {
      params: Promise.resolve({ token: TOKEN_A }),
    })
    expect(res.status).toBe(405)
  })
})
