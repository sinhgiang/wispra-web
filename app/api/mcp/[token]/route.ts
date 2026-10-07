import { createHash } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createMcpHandler } from 'mcp-handler'
import { createAdminClient } from '@/lib/supabase-server'
import { registerTools } from '@/lib/mcp/tools'
import { serverError } from '@/lib/api-errors'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

type ResolveResult = { ok: true; userId: string } | { ok: false; dbError?: string; expired?: boolean }

async function resolveUserId(token: string): Promise<ResolveResult> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('mcp_tokens')
    .select('user_id, expires_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle()
  if (error) return { ok: false, dbError: error.message }
  if (!data) return { ok: false }
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return { ok: false, expired: true }
  await supabase.from('mcp_tokens').update({ last_used_at: new Date().toISOString() }).eq('user_id', data.user_id)
  return { ok: true, userId: data.user_id }
}

// The remote MCP endpoint behind a per-user secret link: .../api/mcp/{token}. Anyone holding
// the link (pasted into ChatGPT/Claude.ai/Grok/etc.) can call it — the token itself, not a
// session or header, is the credential, same model as the reference "Kết nối" page this
// mirrors. Only a hash of the token is stored (see supabase/migrations/003_mcp_tokens.sql).
async function handle(req: NextRequest, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await context.params
  const resolved = await resolveUserId(token)
  if (!resolved.ok) {
    if (resolved.dbError) {
      return serverError('Connection lookup failed', resolved.dbError)
    }
    // 403, not 401: a 401 tells MCP clients (incl. Claude.ai) "this server needs OAuth,"
    // which sends them into a dynamic-client-registration flow Wispra never implements —
    // surfacing as a confusing "Couldn't register with Wispra's sign-in service" error
    // instead of the real problem (a dead/rotated link). 403 means "no" without inviting that.
    if (resolved.expired) {
      return NextResponse.json({ error: 'Connection link has expired' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Invalid or revoked connection link' }, { status: 403 })
  }
  const userId = resolved.userId

  const pathname = new URL(req.url).pathname
  const mcpHandler = createMcpHandler(
    (server) => registerTools(server, userId),
    { serverInfo: { name: 'wispra-mcp', version: '0.1.0' } },
    { streamableHttpEndpoint: pathname, disableSse: true }
  )
  return mcpHandler(req)
}

export { handle as GET, handle as POST, handle as DELETE }
