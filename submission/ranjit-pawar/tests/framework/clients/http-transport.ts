import type { Express } from 'express';
import supertest from 'supertest';

export interface HttpResponse<T = any> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Pre-serialized body; used when the exact bytes matter (webhook signatures). */
  rawBody?: string;
  json?: unknown;
}

/** Transport is abstracted so the same clients can drive an in-process app or a deployed URL. */
export interface HttpTransport {
  get<T = any>(path: string): Promise<HttpResponse<T>>;
  post<T = any>(path: string, options?: RequestOptions): Promise<HttpResponse<T>>;
}

export class SupertestTransport implements HttpTransport {
  constructor(private readonly app: Express) {}

  async get<T>(path: string): Promise<HttpResponse<T>> {
    const res = await supertest(this.app).get(path);
    return { status: res.status, body: res.body as T, headers: res.headers as Record<string, string> };
  }

  async post<T>(path: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    let req = supertest(this.app).post(path);
    for (const [key, value] of Object.entries(options.headers ?? {})) req = req.set(key, value);
    if (options.rawBody !== undefined) {
      req = req.set('Content-Type', options.headers?.['Content-Type'] ?? 'application/json');
      req = req.send(options.rawBody);
    } else {
      req = req.send((options.json ?? {}) as object);
    }
    const res = await req;
    return { status: res.status, body: res.body as T, headers: res.headers as Record<string, string> };
  }
}

/** Provided to show the seam is real: the same suite could run against a deployed service. */
export class FetchTransport implements HttpTransport {
  constructor(private readonly baseUrl: string) {}

  async get<T>(path: string): Promise<HttpResponse<T>> {
    const res = await fetch(`${this.baseUrl}${path}`);
    return { status: res.status, body: (await res.json()) as T, headers: {} };
  }

  async post<T>(path: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      body: options.rawBody ?? JSON.stringify(options.json ?? {})
    });
    return { status: res.status, body: (await res.json()) as T, headers: {} };
  }
}
