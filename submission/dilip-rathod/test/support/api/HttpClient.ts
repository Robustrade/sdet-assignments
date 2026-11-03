import type { Express } from 'express';
import request from 'supertest';
import type { z } from 'zod';
import { ErrorContract } from './contracts';
import type { ErrorDto } from './contracts';

export interface ApiResponse {
  status: number;
  body: unknown;
}

/** Fails with the response body in the message, so a wrong status is diagnosable from the test output alone. */
export function expectStatus(response: ApiResponse, expected: number): void {
  if (response.status !== expected) {
    throw new Error(`Expected HTTP ${expected} but got ${response.status}: ${JSON.stringify(response.body)}`);
  }
}

export function parseContract<T>(contract: z.ZodType<T>, response: ApiResponse, name: string): T {
  const parsed = contract.safeParse(response.body);
  if (!parsed.success) {
    throw new Error(`Response violates ${name} contract: ${parsed.error.message}\nBody: ${JSON.stringify(response.body)}`);
  }
  return parsed.data;
}

/** Asserts an error response: status, error-contract shape, and code. */
export function expectError(response: ApiResponse, status: number, code: string): ErrorDto {
  expectStatus(response, status);
  const error = parseContract(ErrorContract, response, 'Error');
  if (error.error.code !== code) throw new Error(`Expected error code '${code}' but got '${error.error.code}'`);
  return error;
}

/** Transport layer: the only place that knows the API is HTTP served by Supertest. */
export class HttpClient {
  constructor(private readonly app: Express) {}

  async get(path: string): Promise<ApiResponse> {
    const res = await request(this.app).get(path);
    return { status: res.status, body: res.body };
  }

  async postJson(path: string, body?: unknown): Promise<ApiResponse> {
    const req = request(this.app).post(path);
    const res = body === undefined ? await req : await req.send(body as object);
    return { status: res.status, body: res.body };
  }

  /** Sends `raw` byte-for-byte, so signatures computed over it stay valid. */
  async postRaw(path: string, raw: string, headers: Record<string, string> = {}): Promise<ApiResponse> {
    const res = await request(this.app).post(path).set({ 'Content-Type': 'application/json', ...headers }).send(raw);
    return { status: res.status, body: res.body };
  }
}
