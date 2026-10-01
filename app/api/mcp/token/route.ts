import { randomBytes, createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken } from '@/lib/supabase-server'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function authenticate(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  return validateToken(authHeader.slice(7))
}

// GET: connection status only — the plaintext token is never recoverable once
// issued (only its hash is stored), so this can confirm a link exists without
// revealing it. If the desktop app has lost its local copy, it must regenerate.
export async function GET(req: NextRequest) {
  const userId = await authenticate(req)
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('mcp_tokens')
    .select('created_at, last_used_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: `Status lookup failed: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({
    connected: !!data,
    createdAt: data?.created_at ?? null,
    lastUsedAt: data?.last_used_at ?? null,
  })
}

// POST: generate (or rotate) this user's remote-MCP connection token. Returns the
// plaintext token exactly once — only its sha256 hash is persisted server-side.
// Rotating overwrites the stored hash, immediately invalidating any previous link.
export async function POST(req: NextRequest) {
  const userId = await authenticate(req)
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  const token = randomBytes(32).toString('base64url')
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('mcp_tokens')
    .upsert({ user_id: userId, token_hash: hashToken(token), created_at: new Date().toISOString(), last_used_at: null }, { onConflict: 'user_id' })

  if (error) {
    return NextResponse.json({ error: `Token generation failed: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ token })
}

// DELETE: revoke this user's remote-MCP connection — any existing link stops working.
export async function DELETE(req: NextRequest) {
  const userId = await authenticate(req)
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('mcp_tokens').delete().eq('user_id', userId)
  if (error) {
    return NextResponse.json({ error: `Revoke failed: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
