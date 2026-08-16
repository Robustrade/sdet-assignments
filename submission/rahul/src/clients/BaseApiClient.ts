import { APIRequestContext, APIResponse } from '@playwright/test';

export class BaseApiClient {
  protected readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  protected async get(
    endpoint: string,
    options?: Parameters<APIRequestContext['get']>[1]
  ): Promise<APIResponse> {
    return await this.request.get(endpoint, options);
  }

  protected async post(
    endpoint: string,
    options?: Parameters<APIRequestContext['post']>[1]
  ): Promise<APIResponse> {
    return await this.request.post(endpoint, options);
  }

  protected async put(
    endpoint: string,
    options?: Parameters<APIRequestContext['put']>[1]
  ): Promise<APIResponse> {
    return await this.request.put(endpoint, options);
  }

  protected async patch(
    endpoint: string,
    options?: Parameters<APIRequestContext['patch']>[1]
  ): Promise<APIResponse> {
    return await this.request.patch(endpoint, options);
  }

  protected async delete(
    endpoint: string,
    options?: Parameters<APIRequestContext['delete']>[1]
  ): Promise<APIResponse> {
    return await this.request.delete(endpoint, options);
  }
}
