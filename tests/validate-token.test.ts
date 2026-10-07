import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// T-0201 (L5): validateToken checks the token's signature and expiry on the
// server with the project's public key (ES256, as the project publishes), using
// supabase-js's real getClaims, and calls Supabase Auth only for old HS256 tokens.

const SUPABASE_URL = 'https://example-project.supabase.co'
const KID = 'test-key-1'

let privateKey: KeyObject
let jwk: Record<string, unknown>
let otherKey: KeyObject

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url')

function jwt(claims: Record<string, unknown>, { key = privateKey, alg = 'ES256', kid = KID } = {}): string {
  const header = b64url(JSON.stringify({ alg, typ: 'JWT', kid }))
  const payload = b64url(JSON.stringify(claims))
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' })
  return `${header}.${payload}.${b64url(signature)}`
}

const now = () => Math.floor(Date.now() / 1000)
const userClaims = (extra: Record<string, unknown> = {}) => ({
  sub: '00000000-0000-4000-8000-0000000000a1',
  role: 'authenticated',
  aud: 'authenticated',
  iat: now(),
  exp: now() + 3600,
  ...extra,
})

describe('validateToken', () => {
  const fetchMock = vi.fn()
  let validateToken: (token: string) => Promise<string | null>

  beforeAll(async () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    privateKey = pair.privateKey
    jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'ES256', use: 'sig', key_ops: ['verify'] }
    otherKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key')
    ;({ validateToken } = await import('@/lib/supabase-server'))
  })

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.endsWith('/auth/v1/.well-known/jwks.json')) {
        return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      // Supabase Auth's /user: the network check this change avoids for ES256 tokens.
      return new Response(JSON.stringify({ code: 401, msg: 'invalid JWT' }), { status: 401, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const userEndpointCalls = () => fetchMock.mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).includes('/auth/v1/user'))

  it('accepts a signed-in user’s token without calling Supabase Auth', async () => {
    expect(await validateToken(jwt(userClaims()))).toBe('00000000-0000-4000-8000-0000000000a1')
    expect(await validateToken(jwt(userClaims({ sub: '00000000-0000-4000-8000-0000000000b2' })))).toBe('00000000-0000-4000-8000-0000000000b2')
    expect(userEndpointCalls()).toHaveLength(0)
  })

  it('refuses a token signed with another key, or changed after signing', async () => {
    expect(await validateToken(jwt(userClaims(), { key: otherKey }))).toBeNull()
    const [h, , s] = jwt(userClaims()).split('.')
    const forged = `${h}.${b64url(JSON.stringify(userClaims({ sub: '00000000-0000-4000-8000-00000000dead' })))}.${s}`
    expect(await validateToken(forged)).toBeNull()
  })

  it('refuses an expired token', async () => {
    expect(await validateToken(jwt(userClaims({ iat: now() - 7200, exp: now() - 60 })))).toBeNull()
  })

  it('refuses tokens that are not a signed-in user: anon or service keys, no user id', async () => {
    expect(await validateToken(jwt({ role: 'anon', iat: now(), exp: now() + 3600 }))).toBeNull()
    expect(await validateToken(jwt({ role: 'service_role', iat: now(), exp: now() + 3600 }))).toBeNull()
    expect(await validateToken(jwt(userClaims({ sub: '' })))).toBeNull()
    expect(await validateToken(jwt(userClaims({ role: 'anon' })))).toBeNull()
  })

  it('refuses things that are not tokens', async () => {
    for (const bad of ['', 'not-a-token', 'a.b.c', 'Bearer x']) expect(await validateToken(bad)).toBeNull()
  })

  it('sends an old HS256 token to Supabase Auth, and refuses it when Auth does', async () => {
    const hs256 = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(userClaims()))}.c2lnbmF0dXJl`
    expect(await validateToken(hs256)).toBeNull()
    expect(userEndpointCalls()).toHaveLength(1)
  })

  it('fetches the public keys once, not on every request', async () => {
    for (let i = 0; i < 5; i++) await validateToken(jwt(userClaims()))
    const jwksCalls = fetchMock.mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).endsWith('jwks.json'))
    expect(jwksCalls.length).toBeLessThanOrEqual(1)
  })
})
