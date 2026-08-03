import { describe, expect, it } from 'vitest';
import { captureTokenFromUrl } from '../../src/storage/tokenCapture';

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
