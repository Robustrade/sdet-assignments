import { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiClient } from './BaseApiClient';
import { ApiEndpoints } from '../constants/ApiEndpoints';
import { User } from '../models/User';

export class UserApiClient extends BaseApiClient {
  constructor(request: APIRequestContext) {
    super(request);
  }

  async createUser(user: User): Promise<APIResponse> {
    return await this.post(ApiEndpoints.users, {
      data: user,
    });
  }

  async getUsers(): Promise<APIResponse> {
    return await this.get(ApiEndpoints.users);
  }

  async getUser(userId: string): Promise<APIResponse> {
    return await this.get(`${ApiEndpoints.users}/${userId}`);
  }

  async updateUser(userId: string, user: Partial<User>): Promise<APIResponse> {
    return await this.put(`${ApiEndpoints.users}/${userId}`, {
      data: user,
    });
  }

  async deleteUser(userId: string): Promise<APIResponse> {
    return await this.delete(`${ApiEndpoints.users}/${userId}`);
  }
}
