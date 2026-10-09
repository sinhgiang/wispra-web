import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// T-0249: the functions run in Singapore (sin1). Measured from the owner's PC in
// Vietnam with real Groq calls (see docs/REGION.md):
// - a 30 s WAV transcription took 2.6-4.4 s through iad1 and 1.5-2.2 s through sin1;
// - a database read took 300-880 ms from iad1 and 40-140 ms from sin1;
// - Groq refuses calls from Hong Kong (hkg1 answered 403), so hkg1 must not be used.

const config = JSON.parse(readFileSync(join(__dirname, '..', 'vercel.json'), 'utf8')) as { regions?: string[] }

describe('vercel.json', () => {
  it('runs the functions in sin1 only', () => {
    expect(config.regions).toEqual(['sin1'])
  })

  it('never in Hong Kong, where Groq refuses the calls', () => {
    expect(config.regions).not.toContain('hkg1')
  })
})
