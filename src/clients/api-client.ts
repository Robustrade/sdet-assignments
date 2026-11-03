import { APIRequestContext, APIResponse } from "@playwright/test";

export class ApiClient {
  constructor(private readonly request: APIRequestContext) {}

  async get(endpoint: string): Promise<APIResponse> {
    return this.request.get(endpoint);
  }

  async post(
    endpoint: string,
    payload: unknown,
    headers?: Record<string, string>
  ): Promise<APIResponse> {
    return this.request.post(endpoint, {
      data: payload,
      headers
    });
  }

  async put(endpoint: string, payload: unknown): Promise<APIResponse> {
    return this.request.put(endpoint, {
      data: payload
    });
  }

  async patch(endpoint: string, payload: unknown): Promise<APIResponse> {
    return this.request.patch(endpoint, {
      data: payload
    });
  }

  async delete(endpoint: string): Promise<APIResponse> {
    return this.request.delete(endpoint);
  }
}
