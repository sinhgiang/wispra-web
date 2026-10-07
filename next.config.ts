import type { NextConfig } from 'next'

// Security headers on every response (T-0201, T1).
//
// The enforced Content-Security-Policy holds only rules that cannot break a page:
// no framing (clickjacking), no <base> or plugin tricks, forms post only here.
// The full policy runs as Report-Only first: browsers report what it would block
// (in the console) without blocking it. Once the pages show no reports it can
// replace the enforced one. Next.js needs inline scripts and styles, hence
// 'unsafe-inline'; release screenshots come from GitHub, hence img-src https:;
// the Inter font comes from Google Fonts (globals.css).
export const ENFORCED_CSP = ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"].join('; ')

export const REPORT_ONLY_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ')

export const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: ENFORCED_CSP },
  { key: 'Content-Security-Policy-Report-Only', value: REPORT_ONLY_CSP },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
]

const nextConfig: NextConfig = {
  // No static export — Vercel serverless functions handle API routes

  // The site uses plain <img>, never next/image: turn the image optimizer
  // (/_next/image) off so it is not a way in (T-0201, C1).
  images: { unoptimized: true },

  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
}

export default nextConfig
