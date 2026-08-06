// CORS headers for the /api/v1/* surface — see server/cors.ts for the
// wildcard-origin reasoning (bearer-token auth, no ambient credentials).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServerHandle } from './testServer.ts';

let server: TestServerHandle;

afterEach(async () => {
  await server?.close();
});

describe('CORS preflight (OPTIONS)', () => {
  beforeEach(async () => {
    server = await startTestServer();
  });

  it('answers an OPTIONS preflight on an API route with 204 and the expected CORS headers', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/printers`, { method: 'OPTIONS' });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    expect(res.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(res.headers.get('access-control-allow-methods')).toContain('DELETE');
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type');
  });

  it('answers preflight without requiring auth, even when a token is configured', async () => {
    await server.close();
    server = await startTestServer('secret-token');

    const res = await fetch(`${server.baseUrl}/api/v1/printers`, { method: 'OPTIONS' });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('does not dispatch to a route handler for OPTIONS (no body, no route side effects)', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/printers/some-id`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);

    // Confirm nothing was written as a side effect of the preflight.
    const getRes = await fetch(`${server.baseUrl}/api/v1/printers/some-id`);
    expect(getRes.status).toBe(404);
  });
});

describe('CORS headers on real requests', () => {
  beforeEach(async () => {
    server = await startTestServer();
  });

  it('sets Access-Control-Allow-Origin on a real GET response', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('sets CORS headers on a real PUT response', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/printers/printer-1`, {
      method: 'PUT',
      body: JSON.stringify({ id: 'printer-1', name: 'Bench' })
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('sets CORS headers even on an error response (e.g. 401)', async () => {
    await server.close();
    server = await startTestServer('secret-token');

    const res = await fetch(`${server.baseUrl}/api/v1/printers`);
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('does not set CORS headers on non-API (static) responses', async () => {
    const res = await fetch(`${server.baseUrl}/`);
    // No dist/ directory in the test fixture, so this 404s — the point here
    // is purely that the static path isn't given CORS headers.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
