import { describe, expect, it } from 'vitest'
import nextConfig, { ENFORCED_CSP, REPORT_ONLY_CSP } from '../next.config'

// T-0201 (T1): every response carries the security headers. The values a browser
// really receives are also checked on a running build (see the pull request).

describe('security headers', () => {
  it('apply to every path', async () => {
    const rules = await nextConfig.headers!()
    expect(rules).toHaveLength(1)
    expect(rules[0].source).toBe('/:path*')
    const headers = Object.fromEntries(rules[0].headers.map(h => [h.key, h.value]))
    expect(headers).toEqual({
      'Content-Security-Policy': ENFORCED_CSP,
      'Content-Security-Policy-Report-Only': REPORT_ONLY_CSP,
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    })
  })

  it('the enforced policy forbids framing and holds nothing that could block the page itself', () => {
    const directives = ENFORCED_CSP.split('; ')
    expect(directives).toContain("frame-ancestors 'none'")
    expect(directives).toContain("object-src 'none'")
    // No script, style, image, font or connect rules are enforced yet.
    for (const d of directives) expect(d).not.toMatch(/^(default|script|style|img|font|connect)-src/)
  })

  it('the full policy, in report-only mode, keeps everything to this site except https images and Google Fonts', () => {
    expect(REPORT_ONLY_CSP).toContain("default-src 'self'")
    expect(REPORT_ONLY_CSP).toContain("connect-src 'self'")
    expect(REPORT_ONLY_CSP).toContain("img-src 'self' data: https:")
    expect(REPORT_ONLY_CSP).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com")
    expect(REPORT_ONLY_CSP).toContain("font-src 'self' data: https://fonts.gstatic.com")
    expect(REPORT_ONLY_CSP).toContain("frame-ancestors 'none'")
    expect(REPORT_ONLY_CSP).not.toContain('*')
  })
})
