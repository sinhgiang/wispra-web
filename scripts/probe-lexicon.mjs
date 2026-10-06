#!/usr/bin/env node
// Checks GET / PUT /api/lexicon on a deployment with real sign-ins, using TEST
// accounts only. The owner runs it; it asks for the test account(s) and the
// Supabase publishable key, and never prints a token, an email or a word.
//
//   node scripts/probe-lexicon.mjs [deployment URL]
//
// Protected *.vercel.app previews are reached through `vercel curl` (needs
// `vercel login`). Each account's lists are put back as they were at the end.
// Optional environment, for non-interactive runs: PROBE_KEY, PROBE_EMAIL_A,
// PROBE_PASSWORD_A, PROBE_EMAIL_B, PROBE_PASSWORD_B, PROBE_SUPABASE_URL.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'

const DEPLOYMENT = (process.argv[2] ?? 'https://wispra-web.vercel.app').replace(/\/$/, '')
const SUPABASE_URL = process.env.PROBE_SUPABASE_URL ?? 'https://tpiycamfsagesjeciubg.supabase.co'
const RUN = Math.random().toString(36).slice(2, 8)
const PROBE_TERM = `WispraProbe${RUN}`
const PROBE_ID = `probe-${RUN}`

let failures = 0
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures++
  return ok
}

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (hidden) {
      rl._writeToOutput = text => {
        if (text.startsWith(question)) rl.output.write(question)
      }
    }
    rl.question(question, answer => {
      rl.close()
      if (hidden) process.stdout.write('\n')
      resolve(answer.trim())
    })
  })
}

async function signIn(key, email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json().catch(() => ({}))
  return typeof body.access_token === 'string' ? body.access_token : null
}

// One request to the deployment: { status, body }. The token goes in a temp
// file read by curl, never on the command line or the screen.
export function request(method, token, payload) {
  const url = `${DEPLOYMENT}/api/lexicon`
  if (!/\.vercel\.app$/.test(new URL(url).host) || process.env.PROBE_DIRECT) {
    return fetch(url, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'content-type': 'application/json' } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    }).then(async res => ({ status: res.status, body: await res.json().catch(() => null) }))
  }
  const dir = mkdtempSync(join(tmpdir(), 'probe-lexicon-'))
  try {
    const headers = join(dir, 'headers.txt')
    writeFileSync(headers, `${token ? `authorization: Bearer ${token}\n` : ''}content-type: application/json\n`)
    const args = [`"${url}"`, '-s', '-X', method, '-H', `"@${headers}"`, '-w', '"\\n%{http_code}"']
    if (payload) {
      const data = join(dir, 'body.json')
      writeFileSync(data, JSON.stringify(payload))
      args.push('--data-binary', `"@${data}"`)
    }
    const out = spawnSync(`vercel curl ${args.join(' ')}`, { shell: true, encoding: 'utf8', timeout: 120_000 })
    const lines = (out.stdout ?? '').trimEnd().split('\n')
    const status = Number(lines.pop())
    let body = null
    try {
      body = JSON.parse(lines.join('\n'))
    } catch {}
    return Promise.resolve({ status, body })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// What GET returned, in the shape PUT takes.
const asPut = got => ({
  vocabulary: got.vocabulary.terms,
  lexicon: got.lexicon.map(({ syncedAt, ...entry }) => entry),
})
const probeEntry = term => ({ id: PROBE_ID, term, count: 1, enabled: true, pinned: false, source: 'probe' })
const sameLists = (a, b) =>
  JSON.stringify(a.vocabulary.terms) === JSON.stringify(b.vocabulary.terms) &&
  JSON.stringify(a.lexicon.map(e => [e.id, e.term])) === JSON.stringify(b.lexicon.map(e => [e.id, e.term]))

async function main() {
  console.log(`Checking ${DEPLOYMENT}/api/lexicon with test accounts. Nothing typed here is printed.\n`)
  const key = process.env.PROBE_KEY ?? (await ask('Supabase publishable key: ', { hidden: true }))
  const emailA = process.env.PROBE_EMAIL_A ?? (await ask('Test account 1, email: '))
  const passwordA = process.env.PROBE_PASSWORD_A ?? (await ask('Test account 1, password: ', { hidden: true }))
  const emailB = process.env.PROBE_EMAIL_B ?? (await ask('Test account 2, email (Enter to skip): '))
  const passwordB = emailB ? (process.env.PROBE_PASSWORD_B ?? (await ask('Test account 2, password: ', { hidden: true }))) : ''
  console.log('')

  if (emailB && emailB.toLowerCase() === emailA.toLowerCase()) {
    check(false, 'the two test accounts must be different')
    return
  }
  const tokenA = await signIn(key, emailA, passwordA)
  if (!check(Boolean(tokenA), 'test account 1 signs in')) return
  const tokenB = emailB ? await signIn(key, emailB, passwordB) : null
  if (emailB && !check(Boolean(tokenB), 'test account 2 signs in')) return

  // Signed-out and fake sign-ins are refused.
  check((await request('GET', null)).status === 401, 'GET without sign-in: 401')
  check((await request('PUT', 'not-a-real-token', { vocabulary: [] })).status === 401, 'PUT with a fake token: 401')

  const firstA = await request('GET', tokenA)
  if (!check(firstA.status === 200 && Array.isArray(firstA.body?.vocabulary?.terms), 'GET account 1: 200')) return
  const originalA = firstA.body
  console.log(`      account 1 had ${originalA.vocabulary.terms.length} vocabulary terms, ${originalA.lexicon.length} learned words`)

  let originalB = null
  if (tokenB) {
    const firstB = await request('GET', tokenB)
    if (!check(firstB.status === 200, 'GET account 2: 200')) return
    originalB = firstB.body
  }

  try {
    // Account 1 adds one probe term and one probe word to what it has.
    const putA = await request('PUT', tokenA, {
      vocabulary: [...originalA.vocabulary.terms, PROBE_TERM],
      lexicon: [...asPut(originalA).lexicon, probeEntry(PROBE_TERM)],
    })
    check(putA.status === 200 && putA.body?.ok === true, 'PUT account 1: 200')
    const afterA = (await request('GET', tokenA)).body
    check(afterA?.vocabulary?.terms?.includes(PROBE_TERM), 'account 1 reads back its new vocabulary term (real table synced_vocabulary)')
    check(afterA?.lexicon?.some(e => e.id === PROBE_ID && e.term === PROBE_TERM), 'account 1 reads back its new learned word')
    check(afterA?.vocabulary?.terms?.length === originalA.vocabulary.terms.length + 1, 'account 1 kept its other vocabulary terms')
    check(afterA?.lexicon?.length === originalA.lexicon.length + 1, 'account 1 kept its other learned words')

    if (tokenB) {
      const seenB = (await request('GET', tokenB)).body
      check(!seenB.vocabulary.terms.includes(PROBE_TERM) && !seenB.lexicon.some(e => e.id === PROBE_ID), 'account 2 does not see account 1’s term or word')

      // Account 2 writes a word with the same id, then names account 1 in the body.
      await request('PUT', tokenB, { ...asPut(originalB), lexicon: [...asPut(originalB).lexicon, probeEntry(`${PROBE_TERM}B`)], userId: 'account-1' })
      const stillA = (await request('GET', tokenA)).body
      check(stillA.lexicon.some(e => e.id === PROBE_ID && e.term === PROBE_TERM), 'account 2 writing the same word id does not change account 1’s word')
      check(stillA.vocabulary.terms.includes(PROBE_TERM), 'account 1’s vocabulary is untouched by account 2')
    }
  } finally {
    // Put every list back as it was.
    const restoreA = await request('PUT', tokenA, asPut(originalA))
    const backA = (await request('GET', tokenA)).body
    check(restoreA.status === 200 && backA && sameLists(backA, originalA), 'account 1 is back as it was')
    if (tokenB && originalB) {
      const restoreB = await request('PUT', tokenB, asPut(originalB))
      const backB = (await request('GET', tokenB)).body
      check(restoreB.status === 200 && backB && sameLists(backB, originalB), 'account 2 is back as it was')
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
  .catch(err => {
    failures++
    console.log(`FAIL  the check stopped: ${err?.message ?? err}`)
  })
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) failed. Copy these lines to the agent.` : '\nAll checks passed. Copy these lines to the agent.')
    process.exitCode = failures ? 1 : 0
  })
