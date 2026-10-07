import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // No static export — Vercel serverless functions handle API routes

  // The site uses plain <img>, never next/image: turn the image optimizer
  // (/_next/image) off so it is not a way in (T-0201, C1).
  images: { unoptimized: true },
}

export default nextConfig
