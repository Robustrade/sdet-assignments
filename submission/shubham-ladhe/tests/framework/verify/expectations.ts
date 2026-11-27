import { ErrorBody } from '../api/contracts';

/** Asserts an API/webhook result is the given error. Replaces `expect(!res.ok && res.body.error.code)...`. */
export function expectError(
  result: { ok: boolean; status: number; body: unknown },
  status: number,
  code: string,
): ErrorBody['error'] {
  expect({ status: result.status, ok: result.ok }).toEqual({ status, ok: false });
  const { error } = result.body as ErrorBody;
  expect(error.code).toBe(code);
  return error;
}
