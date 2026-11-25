
import type { Express } from 'express';
import request from 'supertest';

type RequestHeaders = Record<string, string>;
type RequestBody = string | object;

export class ApiClient {
  constructor(private readonly app: Express) {}

  private withHeaders<T extends {
    set(field: string, value: string): T;
  }>(
    test: T,
    headers?: RequestHeaders
  ): T {
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        test.set(key, value);
      }
    }

    return test;
  }

  get(path: string, headers?: RequestHeaders) {
    const test = request(this.app).get(path);
    return this.withHeaders(test, headers);
  }

  post(
    path: string,
    body?: RequestBody,
    headers?: RequestHeaders
  ) {
    const test = request(this.app).post(path);
    this.withHeaders(test, headers);

    return body === undefined ? test : test.send(body);
  }

  put(
    path: string,
    body?: RequestBody,
    headers?: RequestHeaders
  ) {
    const test = request(this.app).put(path);
    this.withHeaders(test, headers);

    return body === undefined ? test : test.send(body);
  }

  patch(
    path: string,
    body?: RequestBody,
    headers?: RequestHeaders
  ) {
    const test = request(this.app).patch(path);
    this.withHeaders(test, headers);

    return body === undefined ? test : test.send(body);
  }

  delete(path: string, headers?: RequestHeaders) {
    const test = request(this.app).delete(path);
    return this.withHeaders(test, headers);
  }
}
