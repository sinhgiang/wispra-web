import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createProductionLikeDb, fakeSupabase, queryAs, tokensUsed } from './helpers/test-db'

// T-0249: the server part of the wait after "stop". Writes the user does not need
// to wait for happen after the answer has gone out; the two reads before Groq run
// together; each transcription logs where its time went; cleanup can ask a
// gpt-oss model to think less.

const USER = '00000000-0000-4000-8000-0000000000a1'
const state = vi.hoisted(() => ({ supabase: null as unknown, scheduled: [] as (() => Promise<unknown>)[] }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => (token === 'user-token' ? USER : null),
}))

// Next.js's after(): keep the task, as Vercel would run it once the response is sent.
vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => {
    state.scheduled.push(task)
  },
}))

import { POST as transcribe } from '@/app/api/transcribe/route'
import { POST as chat } from '@/app/api/chat/completions/route'

const runScheduled = async () => {
  const tasks = state.scheduled.splice(0)
  for (const task of tasks) await task()
  return tasks.length
}

function wav(seconds: number): Uint8Array {
  const byteRate = 32_000
  const dataBytes = seconds * byteRate
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  const put = (at: number, text: string) => [...text].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)))
  put(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); put(8, 'WAVE'); put(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 16_000, true); view.setUint32(28, byteRate, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  put(36, 'data'); view.setUint32(40, dataBytes, true)
  return bytes
}

const transcribeRequest = (fields: Record<string, string> = {}) => {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav(4))], { type: 'audio/wav' }), 'audio.wav')
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return transcribe(new NextRequest('http://localhost/api/transcribe', { method: 'POST', headers: { authorization: 'Bearer user-token' }, body: form }))
}

const chatRequest = (extra: Record<string, unknown>) =>
  chat(
    new NextRequest('http://localhost/api/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Clean this up.' }], ...extra }),
    })
  )

describe('server side of the wait after stop', () => {
  let pg: PGlite
  const fetchMock = vi.fn()
  let info: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>

  const secondsUsed = async () =>
    (await pg.query<{ seconds_used: number }>('SELECT seconds_used FROM public.usage WHERE user_id = $1', [USER])).rows[0]?.seconds_used ?? 0

  beforeAll(async () => {
    pg = await createProductionLikeDb([
      '002_sync.sql', '003_mcp_tokens.sql', '004_mcp_token_expiry.sql', '005_ai_token_usage.sql', '006_lock_increment_usage.sql', '007_unlimited_accounts.sql',
    ])
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [USER])
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    state.supabase = fakeSupabase(pg)
    state.scheduled.length = 0
    await pg.exec('DELETE FROM public.usage; DELETE FROM public.ai_token_usage;')
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    info = vi.fn<(...args: unknown[]) => void>()
    vi.spyOn(console, 'info').mockImplementation(info)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('/api/transcribe', () => {
    beforeEach(() => {
      fetchMock.mockImplementation(async () =>
        new Response(JSON.stringify({ text: 'Xin chào.', duration: 4, segments: [{ end: 4 }] }), { status: 200 })
      )
    })

    it('answers before the minutes are written, then writes them', async () => {
      const res = await transcribeRequest()

      expect(res.status).toBe(200)
      expect((await res.json()).text).toBe('Xin chào.')
      expect(await secondsUsed()).toBe(0) // not yet: the answer did not wait for it

      expect(await runScheduled()).toBe(1)
      expect(await secondsUsed()).toBe(4)
    })

    it('reads the plan and this month’s seconds at the same time', async () => {
      const real = fakeSupabase(pg)
      let inFlight = 0
      let mostAtOnce = 0
      const track = <T>(promise: PromiseLike<T>) => {
        inFlight++
        mostAtOnce = Math.max(mostAtOnce, inFlight)
        return Promise.resolve(promise).finally(() => inFlight--)
      }
      state.supabase = {
        ...real,
        from: (table: string) => {
          const q = real.from(table) as unknown as Record<string, unknown>
          const wrap = (obj: Record<string, unknown>): Record<string, unknown> =>
            new Proxy(obj, {
              get(target, prop) {
                const value = target[prop as string]
                if (prop === 'maybeSingle' || prop === 'single') return () => track((value as () => PromiseLike<unknown>)())
                if (typeof value === 'function') return (...args: unknown[]) => {
                  const out = (value as (...a: unknown[]) => unknown).apply(target, args)
                  return out === target ? wrap(target) : out
                }
                return value
              },
            })
          return wrap(q)
        },
      }

      await transcribeRequest()

      expect(mostAtOnce).toBe(2)
    })

    it('logs where the time went, with sizes and no text or user', async () => {
      await transcribeRequest({ model: 'whisper-large-v3-turbo' })
      await runScheduled()

      const line = info.mock.calls.map(c => String(c[0])).find(t => t.startsWith('[transcribe]'))
      expect(line).toBeDefined()
      const data = JSON.parse(line!.slice('[transcribe] '.length))
      expect(data).toMatchObject({ status: 200, model: 'whisper-large-v3-turbo', audioBytes: wav(4).length, audioType: 'audio/wav', seconds: 4 })
      for (const key of ['auth', 'body', 'db', 'groq', 'total', 'recordAfter']) expect(typeof data.ms[key], key).toBe('number')
      expect(line).not.toContain('Xin chào')
      expect(line).not.toContain(USER)
    })

    it('a Groq failure is logged and records nothing', async () => {
      fetchMock.mockImplementation(async () => new Response('{"error":{"message":"bad audio"}}', { status: 400 }))
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await transcribeRequest()

      expect(res.status).toBe(400)
      expect(await runScheduled()).toBe(0)
      expect(await secondsUsed()).toBe(0)
      expect(errors.mock.calls.some(c => String(c[0]).startsWith('[transcribe] {"model"'))).toBe(true)
    })
  })

  describe('/api/chat/completions', () => {
    beforeEach(() => {
      fetchMock.mockImplementation(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'Clean.' } }], usage: { total_tokens: 120 } }), { status: 200 })
      )
    })
    const sentBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)

    it('passes reasoning_effort on to gpt-oss models only, and only known values', async () => {
      await chatRequest({ reasoning_effort: 'low' })
      expect(sentBody()).toMatchObject({ model: 'openai/gpt-oss-120b', reasoning_effort: 'low' })

      await chatRequest({ model: 'openai/gpt-oss-20b', reasoning_effort: 'medium' })
      expect(sentBody()).toMatchObject({ model: 'openai/gpt-oss-20b', reasoning_effort: 'medium' })

      await chatRequest({ model: 'llama-3.1-8b-instant', reasoning_effort: 'low' })
      expect(sentBody().reasoning_effort).toBeUndefined()

      for (const bad of ['none', 'LOW', 3, null]) {
        await chatRequest({ reasoning_effort: bad })
        expect(sentBody().reasoning_effort).toBeUndefined()
      }
      await chatRequest({})
      expect(sentBody().reasoning_effort).toBeUndefined()
    })

    it('logs the reasoning_effort it passed on', async () => {
      await chatRequest({ reasoning_effort: 'low' })
      const line = info.mock.calls.map(c => c.map(String).join(' ')).find(t => t.startsWith('[ai-call]'))
      expect(line).toContain('"reasoningEffort":"low"')
    })

    it('answers before the tokens are written, then writes them', async () => {
      const res = await chatRequest({ reasoning_effort: 'low' })

      expect(res.status).toBe(200)
      expect(await tokensUsed(pg, USER, new Date().toISOString().slice(0, 7))).toBeNull()

      expect(await runScheduled()).toBe(1)
      expect(await tokensUsed(pg, USER, new Date().toISOString().slice(0, 7))).toBe(120)
    })
  })
})
