import { describe, expect, it } from 'vitest';
import {
  BridgeError,
  normalizeBridgeError,
  coerceBridgeError,
  summarizeErrorDetails
} from '../errors';

describe('errors utilities', () => {
  it('normalizes known status codes with friendly message', () => {
    const normalized = normalizeBridgeError(404, 'Not Found');
    expect(normalized.statusCode).toBe(404);
    expect(normalized.message).toMatch(/Not Found/);
  });

  it('falls back for unknown status', () => {
    const normalized = normalizeBridgeError(599);
    expect(normalized.statusCode).toBe(502);
  });

  it('extracts details from JSON payloads', () => {
    const normalized = normalizeBridgeError(
      400,
      JSON.stringify({ error: 'Invalid request payload', details: [{ path: 'prompt' }] })
    );
    expect(normalized.message).toBe('Invalid request payload');
    expect(normalized.details).toEqual([{ path: 'prompt' }]);
  });

  it('coerces BridgeError instances', () => {
    const error = new BridgeError(403, 'Denied', undefined, { reason: 'blocked' });
    const normalized = coerceBridgeError(error);
    expect(normalized).toEqual({ statusCode: 403, message: 'Denied', details: { reason: 'blocked' } });
  });

  it('coerces generic errors to internal error', () => {
    const normalized = coerceBridgeError(new Error('boom'));
    expect(normalized.statusCode).toBe(500);
  });

  it('summarizes array details into bullet list', () => {
    const summary = summarizeErrorDetails([
      { path: 'prompt', message: 'Required' },
      { message: 'Something else' }
    ]);
    expect(summary).toContain('- prompt: Required');
  });
});
