import { describe, expect, it } from 'vitest';
import { captureTokenFromUrl, captureServerUrlFromUrl } from '../../src/storage/tokenCapture';

describe('captureTokenFromUrl', () => {
  it('returns null token and the unchanged URL when there is no token param', () => {
    const result = captureTokenFromUrl('http://localhost:8090/#/dashboard');
    expect(result.token).toBeNull();
    expect(result.strippedUrl).toBe('http://localhost:8090/#/dashboard');
  });

  it('extracts a token param and strips it, dropping the now-empty query string', () => {
    const result = captureTokenFromUrl('http://localhost:8090/?token=test123');
    expect(result.token).toBe('test123');
    expect(result.strippedUrl).toBe('http://localhost:8090/');
  });

  it('preserves the hash fragment (hash-based router state) after stripping', () => {
    const result = captureTokenFromUrl('http://localhost:8090/?token=abc#/wizard/p1/temperature');
    expect(result.token).toBe('abc');
    expect(result.strippedUrl).toBe('http://localhost:8090/#/wizard/p1/temperature');
  });

  it('preserves other query params, removing only token', () => {
    const result = captureTokenFromUrl('http://localhost:8090/?foo=bar&token=abc&baz=1');
    expect(result.token).toBe('abc');
    expect(result.strippedUrl).toBe('http://localhost:8090/?foo=bar&baz=1');
  });

  it('preserves a non-root pathname', () => {
    const result = captureTokenFromUrl('http://localhost:8090/perfectfit/?token=abc');
    expect(result.token).toBe('abc');
    expect(result.strippedUrl).toBe('http://localhost:8090/perfectfit/');
  });

  it('still strips an empty `?token=` param even though the captured value is falsy', () => {
    // URLSearchParams.get('token') on `?token=` returns '' not null. This
    // function still reports/strips it (callers, e.g. main.ts, treat a
    // falsy token as "nothing to store" and skip setStoredToken).
    const result = captureTokenFromUrl('http://localhost:8090/?token=');
    expect(result.token).toBe('');
    expect(result.strippedUrl).toBe('http://localhost:8090/');
  });
});

describe('captureServerUrlFromUrl', () => {
  it('returns null serverUrl and the unchanged URL when there is no server param', () => {
    const result = captureServerUrlFromUrl('http://localhost:5173/#/dashboard');
    expect(result.serverUrl).toBeNull();
    expect(result.strippedUrl).toBe('http://localhost:5173/#/dashboard');
  });

  it('extracts a server param and strips it, dropping the now-empty query string', () => {
    const result = captureServerUrlFromUrl('http://localhost:5173/?server=http%3A%2F%2F192.168.1.50%3A8090');
    expect(result.serverUrl).toBe('http://192.168.1.50:8090');
    expect(result.strippedUrl).toBe('http://localhost:5173/');
  });

  it('preserves the hash fragment after stripping', () => {
    const result = captureServerUrlFromUrl('http://localhost:5173/?server=https%3A%2F%2Fexample.test#/wizard/p1/temperature');
    expect(result.serverUrl).toBe('https://example.test');
    expect(result.strippedUrl).toBe('http://localhost:5173/#/wizard/p1/temperature');
  });

  it('composes with captureTokenFromUrl so a single link can carry both params', () => {
    const original = 'http://localhost:5173/?token=abc&server=https%3A%2F%2Fexample.test&foo=bar';
    const tokenResult = captureTokenFromUrl(original);
    expect(tokenResult.token).toBe('abc');

    const serverResult = captureServerUrlFromUrl(tokenResult.strippedUrl);
    expect(serverResult.serverUrl).toBe('https://example.test');
    expect(serverResult.strippedUrl).toBe('http://localhost:5173/?foo=bar');
  });
});
