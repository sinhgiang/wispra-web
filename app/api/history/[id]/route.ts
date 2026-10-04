import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken } from '@/lib/supabase-server'
import { CLEAR_ALL_ID, recordDeletion } from '@/lib/history-deletions'

type Props = { params: Promise<{ id: string }> }

const ID_MAX = 200

// DELETE /api/history/{id} — deletes one of the signed-in user's history entries,
// desktop or phone, on every device. The id is URL-encoded in the path. The
// deletion is recorded even if the entry is not in the cloud (yet), so a device
// that still has it cannot sync it back.
export async function DELETE(req: NextRequest, { params }: Props) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = await validateToken(authHeader.slice(7))
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  const id = (await params).id
  if (!id || id.length > ID_MAX || id === CLEAR_ALL_ID) {
    return NextResponse.json({ error: `id must be 1 to ${ID_MAX} characters` }, { status: 400 })
  }

  const supabase = createAdminClient()

  // The mark first: if it cannot be written, nothing is deleted (a deletion other
  // devices never hear of would come back with their next sync).
  const { error: markError } = await recordDeletion(supabase, userId, id, new Date().toISOString())
  if (markError) {
    return NextResponse.json({ error: `Could not delete the entry: ${markError.message}` }, { status: 500 })
  }

  // Only ever this user's row: someone else's entry with the same id is untouched.
  const { data: existing, error: findError } = await supabase
    .from('synced_history')
    .select('id')
    .eq('user_id', userId)
    .eq('id', id)
  if (findError) {
    return NextResponse.json({ error: `Could not delete the entry: ${findError.message}` }, { status: 500 })
  }
  const { error } = await supabase.from('synced_history').delete().eq('user_id', userId).eq('id', id)
  if (error) {
    return NextResponse.json({ error: `Could not delete the entry: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, deleted: (existing ?? []).length })
}
