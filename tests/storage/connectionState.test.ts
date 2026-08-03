import { describe, expect, it, beforeEach } from 'vitest';
import { deriveConnectionState, getConnectionState, setConnectionState } from '../../src/storage/connectionState';

describe('deriveConnectionState (pure)', () => {
  it('is no-backend when the health check fails, regardless of authFailed', () => {
    expect(deriveConnectionState({ healthOk: false, authFailed: false })).toBe('no-backend');
    expect(deriveConnectionState({ healthOk: false, authFailed: true })).toBe('no-backend');
  });

  it('is connected when the health check succeeds and no auth failure occurred', () => {
    expect(deriveConnectionState({ healthOk: true, authFailed: false })).toBe('connected');
  });

  it('is needs-token when the health check succeeds but a data call 401ed', () => {
    expect(deriveConnectionState({ healthOk: true, authFailed: true })).toBe('needs-token');
  });
});

describe('getConnectionState / setConnectionState', () => {
  beforeEach(() => {
    setConnectionState('no-backend');
  });

  it('defaults to no-backend', () => {
    expect(getConnectionState()).toBe('no-backend');
  });

  it('reflects the last value written', () => {
    setConnectionState('connected');
    expect(getConnectionState()).toBe('connected');

    setConnectionState('needs-token');
    expect(getConnectionState()).toBe('needs-token');
  });
});
