import { computeSignature, isValidSignature } from '../../src/webhooks/signature';

/** U-03: HMAC-SHA256 over the raw body (assumption A-10). */
describe('U-03 webhook signature', () => {
  const secret = 'shared-secret';
  const body = Buffer.from('{"event_id":"evt_1"}');

  test('accepts the signature computed with the shared secret', () => {
    expect(isValidSignature(secret, body, computeSignature(secret, body))).toBe(true);
  });

  test('rejects a signature made with a different secret', () => {
    expect(isValidSignature(secret, body, computeSignature('other', body))).toBe(false);
  });

  test('rejects a missing signature', () => {
    expect(isValidSignature(secret, body, undefined)).toBe(false);
  });

  test('rejects when the body changed after signing (even by one byte)', () => {
    const signature = computeSignature(secret, body);
    expect(isValidSignature(secret, Buffer.from('{"event_id":"evt_2"}'), signature)).toBe(false);
  });

  test('is computed over raw bytes: re-serialised JSON with different spacing does not match', () => {
    const raw = '{"a": 1}';
    expect(isValidSignature(secret, Buffer.from(JSON.stringify(JSON.parse(raw))), computeSignature(secret, raw))).toBe(false);
  });
});
