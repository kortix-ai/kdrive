// OAuth discovery documents: authorization-server metadata, OpenID
// configuration and the protected-resource document for /mcp.
import { afterEach, describe, expect, test } from 'bun:test';
import { env } from '../env';
import { makeApp } from '../../test/helpers';

const BASE = 'http://localhost:4101';
const get = (path: string, method = 'GET') => makeApp().fetch(new Request(`${BASE}${path}`, { method }));

afterEach(() => {
  env.mcpEnabled = true;
});

describe('authorization-server metadata', () => {
  for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp']) {
    test(`GET ${path}`, async () => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('cache-control')).toBe('public, max-age=300');
      expect(res.headers.get('content-type')).toContain('application/json');
      const doc = (await res.json()) as Record<string, any>;
      expect(doc.issuer).toBe('http://localhost:4100');
      expect(doc.authorization_endpoint).toBe('http://localhost:4100/api/auth/oauth2/authorize');
      expect(doc.token_endpoint).toBe('http://localhost:4100/api/auth/oauth2/token');
      expect(doc.registration_endpoint).toBe('http://localhost:4100/api/auth/oauth2/register');
      expect(doc.jwks_uri).toBe('http://localhost:4100/api/auth/jwks');
      expect(doc.code_challenge_methods_supported).toEqual(['S256']);
      expect(doc.grant_types_supported).toContain('authorization_code');
      expect(doc.grant_types_supported).toContain('refresh_token');
      expect(doc.grant_types_supported).not.toContain('client_credentials');
      expect(doc.scopes_supported).toEqual(expect.arrayContaining(['drive:read', 'drive:propose', 'drive:write', 'offline_access']));
    });
  }

  test('GET /.well-known/openid-configuration', async () => {
    const res = await get('/.well-known/openid-configuration');
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const doc = (await res.json()) as Record<string, any>;
    expect(doc.issuer).toBe('http://localhost:4100');
    expect(doc.authorization_endpoint).toBe('http://localhost:4100/api/auth/oauth2/authorize');
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
  });
});

describe('protected-resource document', () => {
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    test(`GET ${path}`, async () => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
      expect(await res.json()).toEqual({
        resource: 'http://localhost:4100/mcp',
        authorization_servers: ['http://localhost:4100'],
        bearer_methods_supported: ['header'],
        scopes_supported: ['drive:read', 'drive:propose', 'drive:write'],
        resource_name: 'Volumes',
        resource_documentation: 'http://localhost:4100/settings/agents',
      });
    });
  }
});

describe('CORS preflight and the kill switch', () => {
  test('OPTIONS answers 204 with open CORS on every document', async () => {
    for (const path of [
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/mcp',
      '/.well-known/openid-configuration',
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const res = await get(path, 'OPTIONS');
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
      expect(res.headers.get('access-control-allow-headers')).toBe('*');
    }
  });

  test('VOLUMES_MCP_ENABLED=0 answers 404 everywhere', async () => {
    env.mcpEnabled = false;
    for (const path of [
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/mcp',
      '/.well-known/openid-configuration',
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      expect((await get(path)).status).toBe(404);
      expect((await get(path, 'OPTIONS')).status).toBe(404);
    }
  });
});
