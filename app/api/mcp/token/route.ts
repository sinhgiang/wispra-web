import { randomBytes, createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken } from '@/lib/supabase-server'

// A link with no expiry chosen stops working after this many days (T-0201, T3):
// the link is a bearer secret in a URL, which ends up in logs and chat histories.
const DEFAULT_EXPIRY_DAYS = 90

/**
 * Days until a new link expires: a positive number the app sent; null only when
 * it explicitly sent null ("never expires"); DEFAULT_EXPIRY_DAYS otherwise.
 */
function expiryDays(body: { expiresInDays?: unknown }): number | null {
  if (body.expiresInDays === null) return null
  const days = body.expiresInDays
  return typeof days === 'number' && Number.isFinite(days) && days > 0 ? days : DEFAULT_EXPIRY_DAYS
}

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
    .select('created_at, last_used_at, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: `Status lookup failed: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({
    connected: !!data,
    createdAt: data?.created_at ?? null,
    lastUsedAt: data?.last_used_at ?? null,
    expiresAt: data?.expires_at ?? null,
  })
}

// POST: generate (or rotate) this user's remote-MCP connection token. Returns the
// plaintext token exactly once — only its sha256 hash is persisted server-side.
// Rotating overwrites the stored hash, immediately invalidating any previous link.
// Body may include { expiresInDays }: a positive number of days until the new link
// stops working, or null for a link that never expires. Omitted (or not a positive
// number): DEFAULT_EXPIRY_DAYS.
export async function POST(req: NextRequest) {
  const userId = await authenticate(req)
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  const body = ((await req.json().catch(() => ({}))) ?? {}) as { expiresInDays?: unknown }
  const expiresInDays = expiryDays(body)
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null

  const token = randomBytes(32).toString('base64url')
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('mcp_tokens')
    .upsert(
      { user_id: userId, token_hash: hashToken(token), created_at: new Date().toISOString(), last_used_at: null, expires_at: expiresAt },
      { onConflict: 'user_id' }
    )

  if (error) {
    return NextResponse.json({ error: `Token generation failed: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ token, expiresAt })
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
