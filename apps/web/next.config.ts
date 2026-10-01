import path from 'node:path';
import type { NextConfig } from 'next';

// The browser only ever talks to this origin: /api/* is rewritten to the Hono
// API, so cookies are first-party and there is no CORS. No proxy.ts/middleware
// on purpose: it would buffer request bodies (1 MiB block uploads, streams).
const API = process.env.VOLUMES_API_ORIGIN ?? 'http://127.0.0.1:4101';

const nextConfig: NextConfig = {
  transpilePackages: ['@volumes/shared'],
  turbopack: { root: path.join(__dirname, '../..') }, // bun hoists node_modules to the repo root
  experimental: { proxyTimeout: 10 * 60_000 }, // long zip / video streams through the rewrite
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API}/api/:path*` },
      // AI agents: the MCP endpoint and OAuth discovery live on the web origin
      // too. The path-suffixed forms answer clients that probe RFC 8414 / 9728
      // path-inserted URLs (e.g. /.well-known/oauth-protected-resource/mcp).
      { source: '/mcp', destination: `${API}/mcp` },
      { source: '/.well-known/oauth-authorization-server', destination: `${API}/.well-known/oauth-authorization-server` },
      { source: '/.well-known/oauth-authorization-server/:path*', destination: `${API}/.well-known/oauth-authorization-server` },
      { source: '/.well-known/openid-configuration', destination: `${API}/.well-known/openid-configuration` },
      { source: '/.well-known/oauth-protected-resource', destination: `${API}/.well-known/oauth-protected-resource` },
      { source: '/.well-known/oauth-protected-resource/:path*', destination: `${API}/.well-known/oauth-protected-resource` },
    ];
  },
  async redirects() {
    return [
      { source: '/recent-deleted', destination: '/recently-deleted', permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
