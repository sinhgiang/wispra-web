import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createAdminClient } from '@/lib/supabase-server'
import { computeStats } from './stats'
import { lexiconMode } from './lexiconMode'
import type { HistoryRow, MeetingRow, LexiconRow } from './types'

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback
  return Math.max(1, Math.min(value, max))
}

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

/**
 * Registers the same 7 read-only tools as spetotext's local stdio MCP server
 * (mcp-server/src/index.ts), reading from this user's synced_* Supabase rows instead of
 * their local disk — this is the remote counterpart for clients (ChatGPT, Claude.ai, Grok)
 * that can't reach into the user's machine.
 */
export function registerTools(server: McpServer, userId: string): void {
  const supabase = createAdminClient()

  server.registerTool(
    'get_usage_stats',
    {
      description:
        'Get the synced dictation usage stats: total dictations, total minutes, total words, this week\'s counts, current streak, and most active day.'
    },
    async () => {
      const { data, error } = await supabase
        .from('synced_history')
        .select('text, created_at, duration_seconds')
        .eq('user_id', userId)
      if (error) return json({ error: error.message })
      const stats = computeStats((data ?? []) as HistoryRow[])
      return json(stats)
    }
  )

  server.registerTool(
    'list_meetings',
    {
      description: 'List recent synced meeting sessions (title, date, duration, status), newest first.',
      inputSchema: {
        limit: z.number().int().positive().optional().describe('Max sessions to return (default 20, max 50)')
      }
    },
    async ({ limit }: { limit?: number }) => {
      const { data, error } = await supabase
        .from('synced_meetings')
        .select('id, title, summary, created_at, duration_ms, status')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(clamp(limit, 20, 50))
      if (error) return json({ error: error.message })
      return json(
        (data ?? []).map((m) => ({
          id: m.id,
          title: m.title,
          createdAt: m.created_at,
          durationMs: m.duration_ms,
          status: m.status,
          summary: m.summary
        }))
      )
    }
  )

  server.registerTool(
    'get_meeting',
    {
      description: 'Get one synced meeting session in full, including its transcript segments.',
      inputSchema: {
        id: z.string().describe('The meeting session id')
      }
    },
    async ({ id }: { id: string }) => {
      const { data, error } = await supabase
        .from('synced_meetings')
        .select('id, title, summary, created_at, duration_ms, status, segments')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle()
      if (error) return json({ error: error.message })
      if (!data) return json({ error: `No meeting found with id "${id}".` })
      return json({
        id: data.id,
        title: data.title,
        summary: data.summary,
        createdAt: data.created_at,
        durationMs: data.duration_ms,
        status: data.status,
        segments: data.segments
      })
    }
  )

  server.registerTool(
    'search_meetings',
    {
      description: 'Search synced meeting sessions by title, summary, or transcript text. Case-insensitive substring match.',
      inputSchema: {
        query: z.string().describe('Text to search for'),
        limit: z.number().int().positive().optional().describe('Max sessions to return (default 10, max 30)')
      }
    },
    async ({ query, limit }: { query: string; limit?: number }) => {
      const { data, error } = await supabase
        .from('synced_meetings')
        .select('id, title, summary, created_at, duration_ms, status, segments')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      if (error) return json({ error: error.message })

      const needle = query.toLowerCase()
      const matches = ((data ?? []) as MeetingRow[])
        .filter((m) => {
          if (m.title?.toLowerCase().includes(needle)) return true
          if (m.summary?.toLowerCase().includes(needle)) return true
          return (m.segments ?? []).some((seg) => seg.text.toLowerCase().includes(needle))
        })
        .slice(0, clamp(limit, 10, 30))
        .map((m) => ({
          id: m.id,
          title: m.title,
          createdAt: m.created_at,
          durationMs: m.duration_ms,
          status: m.status,
          summary: m.summary
        }))
      return json(matches)
    }
  )

  server.registerTool(
    'search_history',
    {
      description:
        'Search synced dictation history by transcript text. Case-insensitive substring match against both the final text and the raw (pre-cleanup) text, newest first.',
      inputSchema: {
        query: z.string().describe('Text to search for'),
        limit: z.number().int().positive().optional().describe('Max entries to return (default 20, max 50)')
      }
    },
    async ({ query, limit }: { query: string; limit?: number }) => {
      const { data, error } = await supabase
        .from('synced_history')
        .select('id, text, raw_text, created_at, app, topic')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      if (error) return json({ error: error.message })

      const needle = query.toLowerCase()
      const matches = ((data ?? []) as HistoryRow[])
        .filter((entry) => {
          if (entry.text.toLowerCase().includes(needle)) return true
          return entry.raw_text?.toLowerCase().includes(needle) ?? false
        })
        .slice(0, clamp(limit, 20, 50))
        .map((entry) => ({
          id: entry.id,
          text: entry.text,
          createdAt: entry.created_at,
          app: entry.app,
          topic: entry.topic
        }))
      return json(matches)
    }
  )

  server.registerTool(
    'get_history_entry',
    {
      description: 'Get one synced dictation history entry in full by id.',
      inputSchema: {
        id: z.string().describe('The history entry id')
      }
    },
    async ({ id }: { id: string }) => {
      const { data, error } = await supabase
        .from('synced_history')
        .select('id, text, raw_text, created_at, app, topic, language, duration_seconds')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle()
      if (error) return json({ error: error.message })
      if (!data) return json({ error: `No history entry found with id "${id}".` })
      return json({
        id: data.id,
        text: data.text,
        rawText: data.raw_text,
        createdAt: data.created_at,
        app: data.app,
        topic: data.topic,
        language: data.language,
        durationSeconds: data.duration_seconds
      })
    }
  )

  server.registerTool(
    'get_vocabulary',
    {
      description:
        "Get the user's confirmed vocabulary (the Learned tab's lexicon): custom terms and corrected mishearings, each labeled with its mode (replace/hint/spelling/off). Does not include auto-learned/unconfirmed vocabulary."
    },
    async () => {
      const { data, error } = await supabase
        .from('synced_lexicon')
        .select('id, term, heard_as, count, enabled, pinned, source, last_seen')
        .eq('user_id', userId)
      if (error) return json({ error: error.message })
      const entries = ((data ?? []) as LexiconRow[]).map((e) => ({
        term: e.term,
        heardAs: e.heard_as ?? [],
        mode: lexiconMode(e),
        count: e.count,
        pinned: e.pinned,
        source: e.source,
        lastSeen: e.last_seen
      }))
      return json(entries)
    }
  )
}
